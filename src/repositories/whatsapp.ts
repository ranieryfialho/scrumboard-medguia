// T-068 (fase2c-whatsapp-entrada, US-039/US-040/US-041): repositório do
// WhatsApp de entrada. O webhook (T-069) não tem sessão (ASM-034) — o
// `empresaId` vem resolvido da URL, não de uma sessão autenticada; por isso
// as funções aqui aceitam só `Pick<ContextoTenant, 'empresaId'>`, como
// `buscarAnexoPorId` (anexos.ts) já faz para a rota de arquivo sem sessão.
// Tudo passa por `comTenant` (T-040): RLS (T-015) + filtro explícito por
// `empresa_id`, nunca confiando só num dos dois (AC-126).
import { timingSafeEqual } from 'node:crypto';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes, leads, oportunidades, whatsappMensagens } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant, type TransacaoTenant } from './contexto';

export type Lead = typeof leads.$inferSelect;

const CHAVE_SEGREDO_WEBHOOK = 'evolution_webhook_secret';

/**
 * Compara, em tempo constante, o `secretRecebido` contra o
 * `evolution_webhook_secret` cadastrado em `empresa_configuracoes` para
 * `empresaId` (ASM-033). Sem configuração, sem `secretRecebido`, ou valor
 * cadastrado que não é string: `false` sem comparar — `timingSafeEqual`
 * exige buffers do mesmo tamanho. As ACs de autenticação do webhook
 * (AC-119 a AC-121) são provadas na rota (T-069), que depende desta função.
 */
export async function verificarSegredoWebhook(
  db: NodePgDatabase,
  empresaId: string,
  secretRecebido: string | null
): Promise<boolean> {
  if (!secretRecebido) return false;

  return comTenant(db, { empresaId }, async (tx) => {
    const [configuracao] = await tx
      .select({ valor: empresaConfiguracoes.valor })
      .from(empresaConfiguracoes)
      .where(
        and(eq(empresaConfiguracoes.empresaId, empresaId), eq(empresaConfiguracoes.chave, CHAVE_SEGREDO_WEBHOOK))
      )
      .limit(1);

    if (!configuracao || typeof configuracao.valor !== 'string') return false;

    const esperado = Buffer.from(configuracao.valor);
    const recebido = Buffer.from(secretRecebido);
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
  });
}

/**
 * Gera, a partir dos dígitos de `numero` (já normalizado por
 * `extrairMensagens`, T-067), as variações do nono dígito do padrão
 * brasileiro (`55` + DDD de 2 dígitos + 8 ou 9 dígitos) — a Evolution às
 * vezes entrega sem ele, outras vezes com ele (ASM-039, AC-125). Números
 * fora desse padrão não geram variação: só o valor recebido é tentado.
 */
function variantesNumero(numero: string): string[] {
  const variantes = new Set([numero]);
  if (/^55\d{10}$/.test(numero)) {
    // 55 + DDD(2) + 8 dígitos (12 no total) → tenta também com o 9 inserido.
    variantes.add(`${numero.slice(0, 4)}9${numero.slice(4)}`);
  } else if (/^55\d{2}9\d{8}$/.test(numero)) {
    // 55 + DDD(2) + 9 + 8 dígitos (13 no total) → tenta também sem o 9.
    variantes.add(`${numero.slice(0, 4)}${numero.slice(5)}`);
  }
  return [...variantes];
}

/**
 * Casa `numero` com um lead da empresa `empresaId` pelos dígitos de
 * `telefone_e164`, tolerando a variação do nono dígito (AC-125). Sem lead
 * casando: `null`. Mais de um lead com o mesmo telefone na empresa:
 * desempate pela ASM-039 — primeiro o lead cuja oportunidade em cadência
 * (etapas 2-4, sem `cadencia_encerrada_em`) foi atualizada mais
 * recentemente, senão o lead mais recentemente criado.
 */
async function localizarLeadPorNumero(tx: TransacaoTenant, empresaId: string, numero: string): Promise<Lead | null> {
  const digitosTelefone = sql`regexp_replace(coalesce(${leads.telefoneE164}, ''), '\\D', '', 'g')`;

  const resultado = await tx
    .select({ lead: leads })
    .from(leads)
    .leftJoin(
      oportunidades,
      and(
        eq(oportunidades.leadId, leads.id),
        eq(oportunidades.empresaId, leads.empresaId),
        sql`${oportunidades.etapaId} IN (2, 3, 4)`,
        isNull(oportunidades.cadenciaEncerradaEm)
      )
    )
    .where(and(eq(leads.empresaId, empresaId), inArray(digitosTelefone, variantesNumero(numero))))
    .orderBy(sql`${oportunidades.atualizadoEm} DESC NULLS LAST`, desc(leads.criadoEm))
    .limit(1);

  return resultado[0]?.lead ?? null;
}

/** Versão pública de `localizarLeadPorNumero`, sob o tenant do `contexto` (AC-125/AC-126). */
export async function buscarLeadPorNumero(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  numero: string
): Promise<Lead | null> {
  return comTenant(db, contexto, (tx) => localizarLeadPorNumero(tx, contexto.empresaId, numero));
}

export interface DadosMensagemRecebida {
  numero: string;
  texto: string;
  evolutionMessageId: string | null;
}

export interface ResultadoMensagemRecebida {
  /** `false` quando já existia uma linha para esse `evolutionMessageId` na empresa — retentativa da Evolution (AC-124). */
  nova: boolean;
  mensagemId: string | null;
  leadId: string | null;
}

/**
 * Grava a mensagem recebida de forma idempotente (índice único parcial de
 * `whatsapp_mensagens`, migration 0008 — AC-124) e, só quando a inserção foi
 * de fato nova, chama `registrar_conexao_whatsapp` (0008) para a conexão
 * automática que encerra a cadência. A decisão de mover ou não o card
 * (etapas 2-4 vs. o resto, AC-129) é inteira da função SQL — provada em si
 * contra o banco em test/whatsapp/conexao-sql.test.ts; aqui prova-se a
 * ligação de ponta a ponta a partir do repositório. Tudo numa única
 * transação (`comTenant`): não há chamada externa entre o INSERT da
 * mensagem e a conexão (AC-131).
 */
export async function registrarMensagemRecebida(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  dados: DadosMensagemRecebida
): Promise<ResultadoMensagemRecebida> {
  return comTenant(db, contexto, async (tx) => {
    const lead = await localizarLeadPorNumero(tx, contexto.empresaId, dados.numero);
    const leadId = lead?.id ?? null;

    const [inserida] = await tx
      .insert(whatsappMensagens)
      .values({
        empresaId: contexto.empresaId,
        leadId,
        numero: dados.numero,
        mensagem: dados.texto,
        direcao: 'recebida',
        evolutionMessageId: dados.evolutionMessageId,
      })
      .onConflictDoNothing({
        target: [whatsappMensagens.empresaId, whatsappMensagens.evolutionMessageId],
        where: sql`${whatsappMensagens.evolutionMessageId} IS NOT NULL`,
      })
      .returning({ id: whatsappMensagens.id });

    if (!inserida) {
      return { nova: false, mensagemId: null, leadId };
    }

    await tx.execute(
      sql`select registrar_conexao_whatsapp(${contexto.empresaId}::uuid, ${leadId}::uuid, ${dados.evolutionMessageId})`
    );

    return { nova: true, mensagemId: inserida.id, leadId };
  });
}

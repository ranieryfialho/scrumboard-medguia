// T-084 (fase2c-whatsapp-conexao, US-048/US-049): repositório da
// configuração do WhatsApp e do segredo do webhook. Mesmas regras de
// whatsapp-instancia.ts/whatsapp.ts: tudo por `comTenant` (T-040) — RLS
// (migration 0001) + filtro explícito por `empresa_id`, nunca confiando só
// num dos dois. `salvarConfiguracao` grava as chaves permitidas (ASM-050,
// T-083) numa única transação (ASM-056) e traduz a violação do índice
// único parcial da migration 0010 (23505) em `ErroInstanciaEmUso` — a RLS
// esconde a empresa concorrente, então o banco é a única fonte possível
// dessa checagem (ASM-051). `obterOuCriarSegredoWebhook` gera o segredo
// (ASM-049) só na ausência dele, com `INSERT ... ON CONFLICT DO NOTHING` +
// leitura de volta: atômico sob duas chamadas simultâneas porque a
// unicidade de `(empresa_id, chave)` já existe desde a migration 0000.
import { randomBytes } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes } from '../db/schema';
import { CHAVES_PERMITIDAS, type ChaveConfig } from '../domain/whatsapp/config';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

const CHAVE_SEGREDO_WEBHOOK = 'evolution_webhook_secret';

/** `evolution_instance_name` já gravado por outra empresa (AC-173) — índice único parcial da migration 0010. */
export class ErroInstanciaEmUso extends Error {
  constructor() {
    super('Nome de instância já usado por outra empresa.');
    this.name = 'ErroInstanciaEmUso';
  }
}

const ERRCODE_VIOLACAO_UNICIDADE = '23505';

/**
 * O driver `pg` expõe o SQLSTATE em `error.code`, mas o Drizzle (node-postgres)
 * embrulha esse erro num `DrizzleQueryError` cuja causa (`error.cause`) é o
 * erro original do `pg` — checa os dois formatos (mesmo padrão de
 * oportunidades.ts).
 */
function codigoErroPostgres(erro: unknown): string | undefined {
  if (!erro || typeof erro !== 'object') return undefined;
  const comCodigo = erro as { code?: string; cause?: { code?: string } };
  return comCodigo.code ?? comCodigo.cause?.code;
}

export type ConfiguracaoWhatsapp = Partial<Record<ChaveConfig, string>>;

/**
 * Configuração de WhatsApp da empresa do `contexto`: só as seis chaves
 * permitidas (ASM-050), nunca o segredo do webhook nem qualquer outra chave
 * (AC-168). Chave não cadastrada simplesmente não aparece no resultado.
 * Isolado por tenant — a configuração de outra empresa nunca aparece
 * (AC-169).
 */
export async function lerConfiguracao(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>
): Promise<ConfiguracaoWhatsapp> {
  return comTenant(db, contexto, async (tx) => {
    const registros = await tx
      .select({ chave: empresaConfiguracoes.chave, valor: empresaConfiguracoes.valor })
      .from(empresaConfiguracoes)
      .where(
        and(
          eq(empresaConfiguracoes.empresaId, contexto.empresaId),
          inArray(empresaConfiguracoes.chave, [...CHAVES_PERMITIDAS])
        )
      );

    const config: ConfiguracaoWhatsapp = {};
    for (const registro of registros) {
      if (typeof registro.valor === 'string') {
        config[registro.chave as ChaveConfig] = registro.valor;
      }
    }
    return config;
  });
}

/**
 * Grava `valores` na empresa do `contexto`, numa única transação (ASM-056):
 * se uma chave falhar, nenhuma é gravada. Chaves fora de `CHAVES_PERMITIDAS`
 * são ignoradas aqui também, em defesa de profundidade (AC-172) — a
 * validação de entrada já é responsabilidade de `validarCorpoConfig`
 * (T-083), chamada pela rota antes deste repositório. Upsert por
 * `(empresa_id, chave)` (migration 0000): salvar a mesma chave de novo
 * atualiza em vez de duplicar (AC-170).
 *
 * Rejeita com `ErroInstanciaEmUso` (sem gravar nada) quando
 * `evolution_instance_name` já está em uso por outra empresa (AC-173).
 */
export async function salvarConfiguracao(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  valores: ConfiguracaoWhatsapp
): Promise<void> {
  const entradas = Object.entries(valores).filter(([chave]) =>
    (CHAVES_PERMITIDAS as readonly string[]).includes(chave)
  ) as [ChaveConfig, string][];

  if (entradas.length === 0) return;

  await comTenant(db, contexto, async (tx) => {
    try {
      for (const [chave, valor] of entradas) {
        await tx
          .insert(empresaConfiguracoes)
          .values({ empresaId: contexto.empresaId, chave, valor })
          .onConflictDoUpdate({
            target: [empresaConfiguracoes.empresaId, empresaConfiguracoes.chave],
            set: { valor, atualizadoEm: new Date() },
          });
      }
    } catch (erro) {
      if (codigoErroPostgres(erro) === ERRCODE_VIOLACAO_UNICIDADE) {
        throw new ErroInstanciaEmUso();
      }
      throw erro;
    }
  });
}

/**
 * Segredo do webhook da empresa do `contexto` (ASM-049): reaproveita o já
 * cadastrado ou gera um novo de 32 bytes aleatórios (64 caracteres hex),
 * grava e devolve. Atômico sob duas chamadas simultâneas: o
 * `INSERT ... ON CONFLICT DO NOTHING` só grava uma vez (índice único de
 * `empresa_id, chave` da migration 0000); quem perde o conflito lê de volta
 * o que a outra chamada gravou, em vez de trocar o segredo existente
 * (AC-182).
 */
export async function obterOuCriarSegredoWebhook(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>
): Promise<string> {
  return comTenant(db, contexto, async (tx) => {
    const segredoGerado = randomBytes(32).toString('hex');

    const [inserido] = await tx
      .insert(empresaConfiguracoes)
      .values({ empresaId: contexto.empresaId, chave: CHAVE_SEGREDO_WEBHOOK, valor: segredoGerado })
      .onConflictDoNothing({
        target: [empresaConfiguracoes.empresaId, empresaConfiguracoes.chave],
      })
      .returning({ valor: empresaConfiguracoes.valor });

    if (inserido && typeof inserido.valor === 'string') {
      return inserido.valor;
    }

    const [existente] = await tx
      .select({ valor: empresaConfiguracoes.valor })
      .from(empresaConfiguracoes)
      .where(
        and(
          eq(empresaConfiguracoes.empresaId, contexto.empresaId),
          eq(empresaConfiguracoes.chave, CHAVE_SEGREDO_WEBHOOK)
        )
      )
      .limit(1);

    return existente?.valor as string;
  });
}

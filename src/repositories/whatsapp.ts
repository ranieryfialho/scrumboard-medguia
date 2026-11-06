// T-068 (fase2c-whatsapp-entrada, US-039/US-040/US-041): repositório do
// WhatsApp de entrada. O webhook (T-069) não tem sessão (ASM-034) — o
// `empresaId` vem resolvido da URL, não de uma sessão autenticada; por isso
// as funções aqui aceitam só `Pick<ContextoTenant, 'empresaId'>`, como
// `buscarAnexoPorId` (anexos.ts) já faz para a rota de arquivo sem sessão.
// Tudo passa por `comTenant` (T-040): RLS (T-015) + filtro explícito por
// `empresa_id`, nunca confiando só num dos dois (AC-126).
import { timingSafeEqual } from 'node:crypto';

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes, leadTelefones, leads, oportunidades, whatsappAvulsos, whatsappMensagens, whatsappReacoes } from '../db/schema';
import { normalizarNumero, variantesNumero } from '../domain/whatsapp/numero';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant, type TransacaoTenant } from './contexto';
import { promoverNaTransacao } from './whatsapp-promover';

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
 * Casa `numero` com um lead da empresa `empresaId` pelos dígitos do
 * telefone principal (`telefone_e164`) **ou** de um telefone extra dele
 * (`lead_telefones`, T-073/US-047), tolerando a variação do nono dígito em
 * ambos (AC-125, ASM-047). Sem lead casando: `null`. Mais de um lead com o
 * mesmo telefone na empresa — seja porque é principal de um e extra de
 * outro, seja porque é extra de dois (AC-166) — desempate pela ASM-039:
 * primeiro o lead cuja oportunidade em cadência (etapas 2-4, sem
 * `cadencia_encerrada_em`) foi atualizada mais recentemente, senão o lead
 * mais recentemente criado.
 */
async function localizarLeadPorNumero(tx: TransacaoTenant, empresaId: string, numero: string): Promise<Lead | null> {
  const digitosTelefone = sql`regexp_replace(coalesce(${leads.telefoneE164}, ''), '\\D', '', 'g')`;
  const variantes = variantesNumero(numero);

  const leadsComExtraCorrespondente = tx
    .select({ leadId: leadTelefones.leadId })
    .from(leadTelefones)
    .where(and(eq(leadTelefones.empresaId, empresaId), inArray(leadTelefones.numero, variantes)));

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
    .where(
      and(
        eq(leads.empresaId, empresaId),
        or(inArray(digitosTelefone, variantes), inArray(leads.id, leadsComExtraCorrespondente))
      )
    )
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

/** T-290: a mídia que a mensagem carrega; `arquivo` só existe quando o arquivo já está guardado no volume. */
export interface MidiaDaMensagem {
  tipo: 'audio' | 'imagem' | 'video' | 'documento' | 'figurinha';
  mimetype: string | null;
  nome: string | null;
  arquivo?: string | null;
}

function colunasDaMidia(midia: MidiaDaMensagem | undefined) {
  return midia
    ? { midiaTipo: midia.tipo, midiaMimetype: midia.mimetype, midiaNome: midia.nome, midiaArquivo: midia.arquivo ?? null }
    : {};
}

export interface DadosMensagemRecebida {
  numero: string;
  texto: string;
  evolutionMessageId: string | null;
  midia?: MidiaDaMensagem;
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
        ...colunasDaMidia(dados.midia),
      })
      .onConflictDoNothing({
        target: [whatsappMensagens.empresaId, whatsappMensagens.evolutionMessageId],
        where: sql`${whatsappMensagens.evolutionMessageId} IS NOT NULL`,
      })
      .returning({ id: whatsappMensagens.id });

    if (!inserida) {
      return { nova: false, mensagemId: null, leadId };
    }

    // T-303: o número avulso respondeu e quem enviou pediu "criar lead se houver resposta" — vira lead com card em "Entrada de leads".
    let leadFinal = leadId;
    if (!leadId) {
      const [avulso] = await tx
        .select({ nome: whatsappAvulsos.nome, criadoPor: whatsappAvulsos.criadoPor })
        .from(whatsappAvulsos)
        .where(and(eq(whatsappAvulsos.empresaId, contexto.empresaId), inArray(whatsappAvulsos.numero, variantesNumero(dados.numero)), eq(whatsappAvulsos.criarLeadAoResponder, true)))
        .limit(1);
      if (avulso) {
        const promovido = await promoverNaTransacao(
          tx,
          { empresaId: contexto.empresaId, usuarioId: avulso.criadoPor },
          avulso.nome ?? `WhatsApp ${dados.numero}`,
          dados.numero,
          variantesNumero(dados.numero)
        );
        if (promovido.ok) leadFinal = promovido.leadId;
      }
    }

    await tx.execute(
      sql`select registrar_conexao_whatsapp(${contexto.empresaId}::uuid, ${leadFinal}::uuid, ${dados.evolutionMessageId})`
    );

    return { nova: true, mensagemId: inserida.id, leadId: leadFinal };
  });
}

export interface DadosMensagemEnviada {
  numero: string;
  texto: string;
  evolutionMessageId: string | null;
  midia?: MidiaDaMensagem;
}

export interface ResultadoMensagemEnviada {
  mensagemId: string;
  leadId: string | null;
}

/**
 * Grava a mensagem enviada ligando-a ao lead dono de `numero` (principal ou
 * extra, com a variação do nono dígito — AC-141/AC-142), no mesmo molde de
 * `registrarMensagemRecebida`, mas sem idempotência (a Evolution não
 * retentativa envio) e sem chamar `registrar_conexao_whatsapp` — enviar
 * mensagem nunca move card nem encerra cadência (AC-146, provado na rota).
 */
export async function registrarMensagemEnviada(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  dados: DadosMensagemEnviada
): Promise<ResultadoMensagemEnviada> {
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
        direcao: 'enviada',
        // Nasce com um check; "entregue" e "lida" chegam depois pelo webhook (`atualizarStatusDaMensagem`).
        status: 'enviada',
        evolutionMessageId: dados.evolutionMessageId,
        ...colunasDaMidia(dados.midia),
      })
      .returning({ id: whatsappMensagens.id });

    return { mensagemId: inserida.id, leadId };
  });
}

/** enviada (1 check) < entregue (2 checks) < lida (2 azuis). Valor desconhecido conta como "entregue" (o padrão antigo da coluna). */
const POSICAO_DO_STATUS = sql`case lower(${whatsappMensagens.status}) when 'enviada' then 1 when 'lida' then 3 else 2 end`;
const POSICAO_NOVA = { enviada: 1, entregue: 2, lida: 3 } as const;

/**
 * Avança o status de uma mensagem enviada (aviso `messages.update` da Evolution). Só sobe — os avisos chegam fora de ordem e um
 * "entregue" atrasado nunca pode desfazer um "lida". Devolve se mudou algo; ao mudar, avisa a tela aberta (canal `oportunidade`,
 * tipo `mensagem.status`) na mesma transação.
 */
export async function atualizarStatusDaMensagem(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  dados: { evolutionMessageId: string; status: 'enviada' | 'entregue' | 'lida' }
): Promise<boolean> {
  return comTenant(db, contexto, async (tx) => {
    const [atualizada] = await tx
      .update(whatsappMensagens)
      .set({ status: dados.status })
      .where(
        and(
          eq(whatsappMensagens.empresaId, contexto.empresaId),
          eq(whatsappMensagens.evolutionMessageId, dados.evolutionMessageId),
          eq(whatsappMensagens.direcao, 'enviada'),
          sql`${POSICAO_DO_STATUS} < ${POSICAO_NOVA[dados.status]}`
        )
      )
      .returning({ id: whatsappMensagens.id, leadId: whatsappMensagens.leadId });
    if (!atualizada) return false;

    const aviso = JSON.stringify({
      tipo: 'mensagem.status',
      empresaId: contexto.empresaId,
      leadId: atualizada.leadId,
      mensagemId: atualizada.id,
      status: dados.status,
    });
    await tx.execute(sql`select pg_notify('oportunidade', ${aviso})`);
    return true;
  });
}

/** Linha do histórico de conversa com os nomes de campo do legado (ASM-042), para a UI atual continuar funcionando. */
export interface MensagemConversa {
  id: string;
  mensagem: string;
  direcao: 'enviada' | 'recebida';
  created_at: Date;
  numero: string;
  status: string;
  /** T-290: só vem quando a mensagem tem mídia (o arquivo se abre por `GET /api/whatsapp/midia/:id`). */
  midia?: { tipo: MidiaDaMensagem['tipo']; mimetype: string | null; nome: string | null };
  /** Só dá para reagir a mensagem que tem o id da Evolution (as importadas do legado, sem ele, não reagem). */
  reagivel: boolean;
  /** Uma reação por pessoa: a da empresa (`nos`) e/ou a do cliente (`contato`). */
  reacoes: ReacaoDaMensagem[];
}

export interface ReacaoDaMensagem {
  autor: 'nos' | 'contato';
  emoji: string;
}

function mapearParaHistoricoLegado(linha: {
  id: string;
  mensagem: string;
  direcao: 'enviada' | 'recebida';
  criadoEm: Date;
  numero: string;
  status: string;
  midiaTipo: string | null;
  midiaMimetype: string | null;
  midiaNome: string | null;
  evolutionMessageId: string | null;
}): MensagemConversa {
  return {
    id: linha.id,
    mensagem: linha.mensagem,
    direcao: linha.direcao,
    created_at: linha.criadoEm,
    numero: linha.numero,
    status: linha.status,
    reagivel: linha.evolutionMessageId !== null,
    reacoes: [],
    ...(linha.midiaTipo
      ? { midia: { tipo: linha.midiaTipo as MidiaDaMensagem['tipo'], mimetype: linha.midiaMimetype, nome: linha.midiaNome } }
      : {}),
  };
}

const CAMPOS_HISTORICO = {
  id: whatsappMensagens.id,
  mensagem: whatsappMensagens.mensagem,
  direcao: whatsappMensagens.direcao,
  criadoEm: whatsappMensagens.criadoEm,
  numero: whatsappMensagens.numero,
  status: whatsappMensagens.status,
  midiaTipo: whatsappMensagens.midiaTipo,
  midiaMimetype: whatsappMensagens.midiaMimetype,
  midiaNome: whatsappMensagens.midiaNome,
  evolutionMessageId: whatsappMensagens.evolutionMessageId,
};

const LIMITE_HISTORICO = 200;

/** Junta, em uma consulta só, as reações das mensagens do histórico. */
async function anexarReacoes(tx: TransacaoTenant, mensagens: MensagemConversa[]): Promise<MensagemConversa[]> {
  if (mensagens.length === 0) return mensagens;
  const linhas = await tx
    .select({ mensagemId: whatsappReacoes.mensagemId, autor: whatsappReacoes.autor, emoji: whatsappReacoes.emoji })
    .from(whatsappReacoes)
    .where(inArray(whatsappReacoes.mensagemId, mensagens.map((m) => m.id)));
  if (linhas.length === 0) return mensagens;

  const porMensagem = new Map<string, ReacaoDaMensagem[]>();
  for (const linha of linhas) {
    const lista = porMensagem.get(linha.mensagemId) ?? [];
    lista.push({ autor: linha.autor as ReacaoDaMensagem['autor'], emoji: linha.emoji });
    porMensagem.set(linha.mensagemId, lista);
  }
  return mensagens.map((m) => ({ ...m, reacoes: porMensagem.get(m.id) ?? [] }));
}

/**
 * Grava a reação de `autor` a uma mensagem (identificada pelo id da Evolution) — ou a apaga, se `emoji` vier vazio. Cada pessoa tem uma
 * reação por mensagem: trocar o emoji substitui a anterior. Reação a mensagem que não está no CRM é ignorada (devolve `false`). Ao mudar,
 * avisa a conversa aberta (canal `oportunidade`, tipo `mensagem.reacao`) na mesma transação.
 */
export async function registrarReacao(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  dados: { evolutionMessageId: string; autor: 'nos' | 'contato'; emoji: string }
): Promise<boolean> {
  return comTenant(db, contexto, async (tx) => {
    const [mensagem] = await tx
      .select({ id: whatsappMensagens.id, leadId: whatsappMensagens.leadId })
      .from(whatsappMensagens)
      .where(and(eq(whatsappMensagens.empresaId, contexto.empresaId), eq(whatsappMensagens.evolutionMessageId, dados.evolutionMessageId)))
      .limit(1);
    if (!mensagem) return false;

    if (dados.emoji === '') {
      await tx.delete(whatsappReacoes).where(and(eq(whatsappReacoes.mensagemId, mensagem.id), eq(whatsappReacoes.autor, dados.autor)));
    } else {
      await tx
        .insert(whatsappReacoes)
        .values({ empresaId: contexto.empresaId, mensagemId: mensagem.id, autor: dados.autor, emoji: dados.emoji })
        .onConflictDoUpdate({
          target: [whatsappReacoes.mensagemId, whatsappReacoes.autor],
          set: { emoji: dados.emoji, atualizadoEm: sql`now()` },
        });
    }

    const aviso = JSON.stringify({ tipo: 'mensagem.reacao', empresaId: contexto.empresaId, leadId: mensagem.leadId, mensagemId: mensagem.id });
    await tx.execute(sql`select pg_notify('oportunidade', ${aviso})`);
    return true;
  });
}

/** A mensagem para a qual a empresa quer reagir: número, de quem é e o id da Evolution. `null` se não existe neste tenant ou não tem id. */
export async function buscarMensagemParaReacao(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  mensagemId: string
): Promise<{ id: string; numero: string; direcao: 'enviada' | 'recebida'; evolutionMessageId: string } | null> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({ id: whatsappMensagens.id, numero: whatsappMensagens.numero, direcao: whatsappMensagens.direcao, evolutionMessageId: whatsappMensagens.evolutionMessageId })
      .from(whatsappMensagens)
      .where(and(eq(whatsappMensagens.id, mensagemId), eq(whatsappMensagens.empresaId, contexto.empresaId)))
      .limit(1);
    if (!linha || !linha.evolutionMessageId) return null;
    return { ...linha, evolutionMessageId: linha.evolutionMessageId };
  });
}

/**
 * Histórico de uma conversa por número — enviadas e recebidas, das duas
 * grafias do nono dígito (AC-149), da mais antiga para a mais recente,
 * limitado às 200 mais recentes (AC-148). `numero` já deve estar
 * normalizado (ASM-046) — quem normaliza é a rota (T-079), mesmo contrato
 * de `buscarLeadPorNumero`.
 */
export async function buscarHistoricoPorNumero(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  numero: string
): Promise<MensagemConversa[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhas = await tx
      .select(CAMPOS_HISTORICO)
      .from(whatsappMensagens)
      .where(
        and(eq(whatsappMensagens.empresaId, contexto.empresaId), inArray(whatsappMensagens.numero, variantesNumero(numero)))
      )
      .orderBy(desc(whatsappMensagens.criadoEm))
      .limit(LIMITE_HISTORICO);

    return anexarReacoes(tx, linhas.reverse().map(mapearParaHistoricoLegado));
  });
}

/**
 * Histórico de uma conversa por lead — mensagens de todos os telefones dele
 * (principal e extras, com a variação do nono dígito) e as já ligadas pelo
 * `lead_id` (AC-150), sem repetir nenhuma (é uma única consulta com `OR`),
 * da mais antiga para a mais recente, limitado às 200 mais recentes
 * (AC-148). Lead inexistente ou de outro tenant: lista vazia, sem acusar
 * (AC-151) — o filtro por `empresa_id` do `comTenant`/RLS já cuida disso.
 */
export async function buscarHistoricoPorLead(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  leadId: string
): Promise<MensagemConversa[]> {
  return comTenant(db, contexto, async (tx) => {
    const [lead] = await tx
      .select({ telefoneE164: leads.telefoneE164 })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.empresaId, contexto.empresaId)))
      .limit(1);
    if (!lead) return [];

    const extras = await tx
      .select({ numero: leadTelefones.numero })
      .from(leadTelefones)
      .where(and(eq(leadTelefones.leadId, leadId), eq(leadTelefones.empresaId, contexto.empresaId)));

    const principal = lead.telefoneE164 ? normalizarNumero(lead.telefoneE164) : null;
    const telefones = [principal, ...extras.map((extra) => extra.numero)].filter(
      (numero): numero is string => numero !== null
    );
    const variantes = telefones.flatMap((numero) => variantesNumero(numero));

    const condicaoTelefoneOuLead =
      variantes.length > 0
        ? or(eq(whatsappMensagens.leadId, leadId), inArray(whatsappMensagens.numero, variantes))
        : eq(whatsappMensagens.leadId, leadId);

    const linhas = await tx
      .select(CAMPOS_HISTORICO)
      .from(whatsappMensagens)
      .where(and(eq(whatsappMensagens.empresaId, contexto.empresaId), condicaoTelefoneOuLead))
      .orderBy(desc(whatsappMensagens.criadoEm))
      .limit(LIMITE_HISTORICO);

    return anexarReacoes(tx, linhas.reverse().map(mapearParaHistoricoLegado));
  });
}

/** Escolhe, entre as variações do nono dígito de `numero`, a mais curta (sem o nono) como chave estável de agrupamento (AC-155). */
export function chaveCanonicaNumero(numero: string): string {
  return [...variantesNumero(numero)].sort((a, b) => a.length - b.length)[0];
}

/** Uma conversa não lida, agrupada por lead (todos os telefones dele) ou por número normalizado (ASM-045), nos nomes do legado (ASM-042). */
export interface ConversaNaoLida {
  numero: string;
  leadId: string | null;
  lastMessage: string;
  lastAt: Date;
  count: number;
}

/**
 * Lista as conversas com mensagens recebidas ainda não lidas (`lida_em`
 * nula) da empresa do `contexto`, uma linha por conversa — por `lead_id`
 * quando a mensagem está ligada a um lead (reunindo os telefones dele numa
 * só, AC-155), senão pelo número canônico (as duas grafias do nono dígito
 * contam como a mesma conversa, AC-155) — com a contagem só das não lidas
 * (AC-154), da mais recente para a mais antiga.
 */
export async function listarConversasNaoLidas(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>
): Promise<ConversaNaoLida[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhas = await tx
      .select({
        leadId: whatsappMensagens.leadId,
        numero: whatsappMensagens.numero,
        mensagem: whatsappMensagens.mensagem,
        criadoEm: whatsappMensagens.criadoEm,
      })
      .from(whatsappMensagens)
      .where(
        and(
          eq(whatsappMensagens.empresaId, contexto.empresaId),
          eq(whatsappMensagens.direcao, 'recebida'),
          isNull(whatsappMensagens.lidaEm)
        )
      )
      .orderBy(desc(whatsappMensagens.criadoEm));

    const conversas = new Map<string, ConversaNaoLida>();
    for (const linha of linhas) {
      const chave = linha.leadId ?? chaveCanonicaNumero(linha.numero);
      const existente = conversas.get(chave);
      if (existente) {
        existente.count += 1;
      } else {
        conversas.set(chave, {
          numero: linha.numero,
          leadId: linha.leadId,
          lastMessage: linha.mensagem,
          lastAt: linha.criadoEm,
          count: 1,
        });
      }
    }

    return [...conversas.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  });
}

/** Conversa a marcar como lida: por `leadId` (reúne todos os telefones dele) ou por `numero` avulso (sem lead, com a variação do nono dígito). */
export interface AlvoConversa {
  leadId?: string;
  numero?: string;
}

/**
 * Marca como lidas (`lida_em = now()`) as mensagens recebidas ainda não
 * lidas da conversa indicada por `alvo` — nunca mexe em outra conversa nem
 * em outra empresa (AC-158, o filtro por `empresa_id` do `comTenant`/RLS e a
 * condição exata do alvo garantem isso). Idempotente: devolve quantas foram
 * marcadas agora (`0` se já estavam todas lidas, AC-158). Mensagem nova
 * chegando depois (webhook) nasce com `lida_em` nula e volta a contar
 * (AC-159, garantido por `registrarMensagemRecebida` não tocar nesta
 * coluna).
 */
export async function marcarConversaComoLida(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  alvo: AlvoConversa
): Promise<number> {
  return comTenant(db, contexto, async (tx) => {
    const condicaoAlvo = alvo.leadId
      ? eq(whatsappMensagens.leadId, alvo.leadId)
      : alvo.numero
        ? and(isNull(whatsappMensagens.leadId), inArray(whatsappMensagens.numero, variantesNumero(alvo.numero)))
        : null;

    if (!condicaoAlvo) return 0;

    const atualizadas = await tx
      .update(whatsappMensagens)
      .set({ lidaEm: new Date() })
      .where(
        and(
          eq(whatsappMensagens.empresaId, contexto.empresaId),
          eq(whatsappMensagens.direcao, 'recebida'),
          isNull(whatsappMensagens.lidaEm),
          condicaoAlvo
        )
      )
      .returning({ id: whatsappMensagens.id });

    return atualizadas.length;
  });
}

/** T-290 (AC-745): o que a rota da mídia precisa para abrir o arquivo de uma mensagem. */
export interface MidiaParaAbrir {
  id: string;
  tipo: MidiaDaMensagem['tipo'];
  mimetype: string | null;
  nome: string | null;
  arquivo: string | null;
  evolutionMessageId: string | null;
}

/** A mídia de uma mensagem da empresa do `contexto`; `null` se a mensagem não existe, é de outra empresa ou não tem mídia. */
export async function buscarMidiaDaMensagem(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  mensagemId: string
): Promise<MidiaParaAbrir | null> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({
        id: whatsappMensagens.id,
        tipo: whatsappMensagens.midiaTipo,
        mimetype: whatsappMensagens.midiaMimetype,
        nome: whatsappMensagens.midiaNome,
        arquivo: whatsappMensagens.midiaArquivo,
        evolutionMessageId: whatsappMensagens.evolutionMessageId,
      })
      .from(whatsappMensagens)
      .where(and(eq(whatsappMensagens.id, mensagemId), eq(whatsappMensagens.empresaId, contexto.empresaId)))
      .limit(1);
    if (!linha || !linha.tipo) return null;
    return { ...linha, tipo: linha.tipo as MidiaDaMensagem['tipo'] };
  });
}

/** T-290: guarda o caminho do arquivo (e o mimetype real) depois de buscá-lo na Evolution. */
export async function guardarArquivoDaMidia(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  mensagemId: string,
  arquivo: string,
  mimetype: string
): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx
      .update(whatsappMensagens)
      .set({ midiaArquivo: arquivo, midiaMimetype: mimetype })
      .where(and(eq(whatsappMensagens.id, mensagemId), eq(whatsappMensagens.empresaId, contexto.empresaId)));
  });
}

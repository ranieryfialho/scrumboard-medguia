// T-250 (fase5-whatsapp-lote-disparo, US-162/US-164): lotes de WhatsApp — criar (com a prévia recalculada no
// servidor), listar, detalhar e cancelar — e as duas operações que o worker usa (reivindicar o próximo item e
// registrar o resultado). Sempre por `comTenant`: o RLS isola as empresas (AC-683).
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { usuarios, whatsappLoteItens, whatsappLotes } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import type { PreviaDoLote } from '../lib/whatsapp/lote-regras';
import { comTenant } from './contexto';
import { previaDoLote } from './whatsapp-lote-previa';
import { buscarNomeInstancia } from './whatsapp-instancia';
import { buscarTemplate } from './whatsapp-templates';

export type StatusDoLote = 'em_andamento' | 'concluido' | 'cancelado';
export type StatusDoItem = 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'cancelado';

export interface ContagensDoLote {
  enviados: number;
  falhas: number;
  pendentes: number;
  cancelados: number;
}
export interface LoteView extends ContagensDoLote {
  id: string;
  templateNome: string;
  criadoPorNome: string | null;
  status: StatusDoLote;
  total: number;
  criadoEm: string;
  finalizadoEm: string | null;
}
export interface ItemView {
  id: string;
  nome: string;
  telefone: string;
  status: StatusDoItem;
  erro: string | null;
  enviadoEm: string | null;
}

export type ResultadoDaCriacao =
  | { ok: true; loteId: string; total: number; excluidos: PreviaDoLote['excluidos']; duracaoEstimadaSegundos: number }
  | { ok: false; codigo: 'TEMPLATE_NAO_ENCONTRADO' | 'TEMPLATE_NAO_APROVADO' | 'WHATSAPP_NAO_CONFIGURADO' | 'SEM_DESTINATARIOS' | 'LOTE_EM_ANDAMENTO' };

/** AC-677/AC-678: cria o lote com os elegíveis da prévia recalculada aqui; nada é gravado em caso de recusa. */
export async function criarLote(db: NodePgDatabase, contexto: ContextoTenant, entrada: { templateId: string; leadIds: string[] }): Promise<ResultadoDaCriacao> {
  const template = await buscarTemplate(db, contexto, entrada.templateId);
  if (!template) return { ok: false, codigo: 'TEMPLATE_NAO_ENCONTRADO' };
  if (template.status !== 'aprovado') return { ok: false, codigo: 'TEMPLATE_NAO_APROVADO' };
  if (!(await buscarNomeInstancia(db, contexto))) return { ok: false, codigo: 'WHATSAPP_NAO_CONFIGURADO' };

  const previa = await previaDoLote(db, contexto, entrada.leadIds, template.corpo);
  if (previa.elegiveis.length === 0) return { ok: false, codigo: 'SEM_DESTINATARIOS' };

  try {
    const loteId = await comTenant(db, contexto, async (tx) => {
      const [lote] = await tx
        .insert(whatsappLotes)
        .values({ empresaId: contexto.empresaId, templateId: template.id, templateNome: template.nome, criadoPor: contexto.usuarioId, total: previa.elegiveis.length })
        .returning({ id: whatsappLotes.id });
      await tx.insert(whatsappLoteItens).values(
        previa.elegiveis.map((e, i) => ({ loteId: lote.id, empresaId: contexto.empresaId, leadId: e.leadId, ordem: i + 1, nome: e.nome, telefone: e.telefone, mensagem: e.mensagem }))
      );
      return lote.id;
    });
    return { ok: true, loteId, total: previa.elegiveis.length, excluidos: previa.excluidos, duracaoEstimadaSegundos: previa.duracaoEstimadaSegundos };
  } catch {
    return { ok: false, codigo: 'LOTE_EM_ANDAMENTO' }; // índice único: um lote em andamento por empresa (ASM-246)
  }
}

const contar = (status: StatusDoItem[]) => sql<number>`count(*) filter (where ${whatsappLoteItens.status} in (${sql.join(status.map((s) => sql`${s}`), sql`, `)}))::int`;

/** AC-683: os lotes da empresa, do mais novo para o mais antigo, com as contagens. */
export async function listarLotes(db: NodePgDatabase, contexto: ContextoTenant): Promise<LoteView[]> {
  return comTenant(db, contexto, async (tx) => {
    const linhas = await tx
      .select({
        id: whatsappLotes.id,
        templateNome: whatsappLotes.templateNome,
        criadoPorNome: usuarios.nome,
        status: whatsappLotes.status,
        total: whatsappLotes.total,
        criadoEm: whatsappLotes.criadoEm,
        finalizadoEm: whatsappLotes.finalizadoEm,
        enviados: contar(['enviado']),
        falhas: contar(['falhou']),
        pendentes: contar(['pendente', 'enviando']),
        cancelados: contar(['cancelado']),
      })
      .from(whatsappLotes)
      .leftJoin(usuarios, eq(usuarios.id, whatsappLotes.criadoPor))
      .leftJoin(whatsappLoteItens, eq(whatsappLoteItens.loteId, whatsappLotes.id))
      .groupBy(whatsappLotes.id, usuarios.nome)
      .orderBy(desc(whatsappLotes.criadoEm), desc(whatsappLotes.id))
      .limit(50);
    return linhas.map((l) => ({ ...l, status: l.status as StatusDoLote, criadoEm: l.criadoEm.toISOString(), finalizadoEm: l.finalizadoEm?.toISOString() ?? null }));
  });
}

export async function detalharLote(db: NodePgDatabase, contexto: ContextoTenant, id: string): Promise<{ lote: LoteView; itens: ItemView[] } | null> {
  const lote = (await listarLotes(db, contexto)).find((l) => l.id === id);
  if (!lote) return null;
  const itens = await comTenant(db, contexto, (tx) =>
    tx
      .select({ id: whatsappLoteItens.id, nome: whatsappLoteItens.nome, telefone: whatsappLoteItens.telefone, status: whatsappLoteItens.status, erro: whatsappLoteItens.erro, enviadoEm: whatsappLoteItens.enviadoEm })
      .from(whatsappLoteItens)
      .where(eq(whatsappLoteItens.loteId, id))
      .orderBy(whatsappLoteItens.ordem)
  );
  return { lote, itens: itens.map((i) => ({ ...i, status: i.status as StatusDoItem, enviadoEm: i.enviadoEm?.toISOString() ?? null })) };
}

export type ResultadoDoCancelamento = { ok: true; lote: LoteView } | { ok: false; codigo: 'LOTE_NAO_ENCONTRADO' | 'LOTE_ENCERRADO' };

/** AC-684: os pendentes viram cancelados e o lote vira cancelado; os já enviados ficam como estão. */
export async function cancelarLote(db: NodePgDatabase, contexto: ContextoTenant, id: string): Promise<ResultadoDoCancelamento> {
  const atual = (await listarLotes(db, contexto)).find((l) => l.id === id);
  if (!atual) return { ok: false, codigo: 'LOTE_NAO_ENCONTRADO' };
  if (atual.status !== 'em_andamento') return { ok: false, codigo: 'LOTE_ENCERRADO' };
  await comTenant(db, contexto, async (tx) => {
    await tx.update(whatsappLoteItens).set({ status: 'cancelado', erro: 'LOTE_CANCELADO' }).where(and(eq(whatsappLoteItens.loteId, id), eq(whatsappLoteItens.status, 'pendente')));
    await tx.update(whatsappLotes).set({ status: 'cancelado', finalizadoEm: sql`now()` }).where(eq(whatsappLotes.id, id));
  });
  return { ok: true, lote: (await listarLotes(db, contexto)).find((l) => l.id === id)! };
}

export interface ItemParaEnviar {
  id: string;
  loteId: string;
  leadId: string | null;
  telefone: string;
  mensagem: string;
  restantes: number;
}

/**
 * Worker (AC-679): pega o próximo item pendente do lote em andamento da empresa cujo `proximo_envio_em` já chegou,
 * marcando-o "enviando" na mesma transação (`SKIP LOCKED`: duas chamadas do cron nunca pegam o mesmo item).
 */
export async function reivindicarProximoItem(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>, agora: Date): Promise<ItemParaEnviar | null> {
  return comTenant(db, contexto, async (tx) => {
    const lotes = await tx.execute<{ id: string }>(sql`
      SELECT id FROM whatsapp_lotes WHERE status = 'em_andamento' AND proximo_envio_em <= ${agora.toISOString()}::timestamptz
      ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    const lote = lotes.rows[0];
    if (!lote) return null;
    const itens = await tx.execute<{ id: string; lead_id: string | null; telefone: string; mensagem: string }>(sql`
      SELECT id, lead_id, telefone, mensagem FROM whatsapp_lote_itens WHERE lote_id = ${lote.id} AND status = 'pendente'
      ORDER BY ordem LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    const item = itens.rows[0];
    if (!item) return null;
    await tx.update(whatsappLoteItens).set({ status: 'enviando' }).where(eq(whatsappLoteItens.id, item.id));
    const restantes = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM whatsapp_lote_itens WHERE lote_id = ${lote.id} AND status = 'pendente'`);
    return { id: item.id, loteId: lote.id, leadId: item.lead_id, telefone: item.telefone, mensagem: item.mensagem, restantes: restantes.rows[0].n };
  });
}

/**
 * Worker (AC-679/AC-680/AC-681): grava o resultado do item. Enviado ou falhou segura o próximo envio por
 * `intervaloSegundos`; cancelado (consentimento revogado) não conta para o intervalo (ASM-250). Sem mais itens a
 * sair, o lote vira concluído.
 */
export async function registrarResultadoDoItem(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  item: ItemParaEnviar,
  resultado: { status: 'enviado' | 'falhou' | 'cancelado'; erro?: string },
  agora: Date,
  intervaloSegundos: number
): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx
      .update(whatsappLoteItens)
      .set({ status: resultado.status, erro: resultado.erro ?? null, enviadoEm: resultado.status === 'enviado' ? agora : null })
      .where(eq(whatsappLoteItens.id, item.id));
    if (resultado.status !== 'cancelado') {
      await tx
        .update(whatsappLotes)
        .set({ proximoEnvioEm: new Date(agora.getTime() + intervaloSegundos * 1000) })
        .where(eq(whatsappLotes.id, item.loteId));
    }
    const abertos = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM whatsapp_lote_itens WHERE lote_id = ${item.loteId} AND status IN ('pendente', 'enviando')`);
    if (abertos.rows[0].n === 0) {
      await tx.update(whatsappLotes).set({ status: 'concluido', finalizadoEm: agora }).where(and(eq(whatsappLotes.id, item.loteId), eq(whatsappLotes.status, 'em_andamento')));
    }
  });
}

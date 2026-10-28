// T-185 (fase4-tarefas-agenda, US-122): agendar, registrar no-show, concluir e
// reagendar uma reunião, sempre movendo o card pelas regras do funil
// (`transicionarCard`, a mesma do card avulso e dos lotes) — a agenda e o funil
// nunca divergem (AC-489 a AC-495). A transição vem ANTES de gravar a reunião:
// se o card não puder se mover, nada é gravado. O evento de card movido sai
// pela própria `mover_oportunidade` (AC-495). ATENDENTE só age nos próprios
// cards; card/reunião de outra empresa é "não encontrado" (AC-494).
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { reunioes } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { buscarOportunidadePorId } from './oportunidades';
import {
  ETAPA_NO_SHOW,
  ETAPA_QUALIFICADO_P_REUNIAO,
  ETAPA_REUNIAO_AGENDADA,
  ETAPA_REUNIAO_REALIZADA,
  buscarReuniao,
  type ReuniaoDaAgenda,
} from './reunioes';
import { transicionarCard } from './transicao-card';

export type ResultadoAcao = { ok: true; reuniao: ReuniaoDaAgenda } | { ok: false; codigo: string };

const TAMANHO_MAXIMO_RESUMO = 2000;

function podeAgirNoCard(contexto: ContextoTenant, responsavelId: string | null): boolean {
  if (contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE') return true;
  return responsavelId === contexto.usuarioId;
}

async function reuniaoPorId(db: NodePgDatabase, contexto: ContextoTenant, id: string): Promise<ResultadoAcao> {
  const achada = await buscarReuniao(db, contexto, id);
  return achada ? { ok: true, reuniao: achada.reuniao } : { ok: false, codigo: 'REUNIAO_NAO_ENCONTRADA' };
}

async function inserir(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dados: { oportunidadeId: string; agendadaPara: Date; remarcadaDe?: string }
): Promise<string> {
  return comTenant(db, contexto, async (tx) => {
    const [criada] = await tx
      .insert(reunioes)
      .values({
        oportunidadeId: dados.oportunidadeId,
        empresaId: contexto.empresaId,
        agendadaPara: dados.agendadaPara,
        remarcadaDe: dados.remarcadaDe ?? null,
      })
      .returning({ id: reunioes.id });
    return criada.id;
  });
}

/** AC-489/AC-490. */
export async function agendarReuniao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  entrada: { oportunidadeId: string; agendadaPara: Date; agora: Date }
): Promise<ResultadoAcao> {
  const card = await buscarOportunidadePorId(db, contexto, entrada.oportunidadeId);
  if (!card || !podeAgirNoCard(contexto, card.responsavelId)) return { ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' };
  if (entrada.agendadaPara.getTime() <= entrada.agora.getTime()) return { ok: false, codigo: 'DATA_NO_PASSADO' };
  if (card.etapaId !== ETAPA_QUALIFICADO_P_REUNIAO) return { ok: false, codigo: 'CARD_NAO_PODE_AGENDAR' };

  const movido = await transicionarCard(db, contexto, card.id, { version: card.version, etapaDestinoId: ETAPA_REUNIAO_AGENDADA });
  if (!movido.ok) return movido;

  const id = await inserir(db, contexto, { oportunidadeId: card.id, agendadaPara: entrada.agendadaPara });
  return reuniaoPorId(db, contexto, id);
}

async function reuniaoDoUsuario(db: NodePgDatabase, contexto: ContextoTenant, id: string) {
  const achada = await buscarReuniao(db, contexto, id);
  if (!achada || !podeAgirNoCard(contexto, achada.responsavelId)) return null;
  return achada.reuniao;
}

/** AC-491. */
export async function registrarNoShow(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string,
  agora: Date
): Promise<ResultadoAcao> {
  const r = await reuniaoDoUsuario(db, contexto, id);
  if (!r) return { ok: false, codigo: 'REUNIAO_NAO_ENCONTRADA' };
  if (r.encerradaEm || r.noShow) return { ok: false, codigo: 'REUNIAO_JA_TEM_RESULTADO' };
  if (r.status === 'remarcada') return { ok: false, codigo: 'REUNIAO_REMARCADA' };
  if (new Date(r.agendadaPara).getTime() > agora.getTime()) return { ok: false, codigo: 'AINDA_NAO_ACONTECEU' };

  const movido = await transicionarCard(db, contexto, r.oportunidadeId, { version: r.version, etapaDestinoId: ETAPA_NO_SHOW });
  if (!movido.ok) return movido;

  await comTenant(db, contexto, (tx) =>
    tx.update(reunioes).set({ noShow: true }).where(and(eq(reunioes.id, id), eq(reunioes.empresaId, contexto.empresaId)))
  );
  return reuniaoPorId(db, contexto, id);
}

/** AC-492: a evidência (anexo do card) é exigida pela etapa "Reunião realizada". */
export async function concluirReuniao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string,
  entrada: { resumo?: string | null; anexoId?: string | null; agora: Date }
): Promise<ResultadoAcao> {
  if (entrada.resumo && entrada.resumo.length > TAMANHO_MAXIMO_RESUMO) return { ok: false, codigo: 'REQUISICAO_INVALIDA' };
  const r = await reuniaoDoUsuario(db, contexto, id);
  if (!r) return { ok: false, codigo: 'REUNIAO_NAO_ENCONTRADA' };
  if (r.encerradaEm || r.noShow) return { ok: false, codigo: 'REUNIAO_JA_TEM_RESULTADO' };
  if (r.status === 'remarcada') return { ok: false, codigo: 'REUNIAO_REMARCADA' };

  const movido = await transicionarCard(db, contexto, r.oportunidadeId, {
    version: r.version,
    etapaDestinoId: ETAPA_REUNIAO_REALIZADA,
    anexoId: entrada.anexoId ?? null,
  });
  if (!movido.ok) return movido;

  await comTenant(db, contexto, (tx) =>
    tx
      .update(reunioes)
      .set({ encerradaEm: entrada.agora, resumo: entrada.resumo?.trim() || null, anexoId: entrada.anexoId ?? null })
      .where(and(eq(reunioes.id, id), eq(reunioes.empresaId, contexto.empresaId)))
  );
  return reuniaoPorId(db, contexto, id);
}

/** AC-493: nasce uma nova reunião ligada à anterior; do "No-show" o card volta para "Reunião agendada". */
export async function reagendarReuniao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  id: string,
  entrada: { agendadaPara: Date; agora: Date }
): Promise<ResultadoAcao> {
  const r = await reuniaoDoUsuario(db, contexto, id);
  if (!r) return { ok: false, codigo: 'REUNIAO_NAO_ENCONTRADA' };
  if (r.encerradaEm && !r.noShow) return { ok: false, codigo: 'REUNIAO_JA_TEM_RESULTADO' };
  if (r.status === 'remarcada') return { ok: false, codigo: 'REUNIAO_REMARCADA' };
  if (entrada.agendadaPara.getTime() <= entrada.agora.getTime()) return { ok: false, codigo: 'DATA_NO_PASSADO' };
  if (r.etapaId !== ETAPA_NO_SHOW && r.etapaId !== ETAPA_REUNIAO_AGENDADA) return { ok: false, codigo: 'CARD_NAO_PODE_AGENDAR' };

  if (r.etapaId === ETAPA_NO_SHOW) {
    const movido = await transicionarCard(db, contexto, r.oportunidadeId, { version: r.version, etapaDestinoId: ETAPA_REUNIAO_AGENDADA });
    if (!movido.ok) return movido;
  }

  const novaId = await inserir(db, contexto, { oportunidadeId: r.oportunidadeId, agendadaPara: entrada.agendadaPara, remarcadaDe: id });
  return reuniaoPorId(db, contexto, novaId);
}

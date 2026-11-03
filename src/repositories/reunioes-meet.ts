// T-301 (fase4-tarefas-agenda, US-122, AC-765 a AC-770): a sala do Meet de cada reunião. Cria o evento no Google Calendar da conta conectada
// (com a sala do Meet e o convite por e-mail ao lead e ao closer), guarda o link e o id do evento, muda o horário quando a reunião é
// remarcada e apaga o evento quando ela é cancelada. NUNCA derruba a agenda: sem Google conectado, sem credenciais no servidor ou com o
// Google fora do ar, a reunião continua valendo, só sem o link (a tela oferece "Gerar link do Meet" depois). Por isso nenhuma função daqui
// lança: todas devolvem o resultado.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidades, reunioes, usuarios } from '../db/schema';
import {
  apagarEvento,
  configDoGoogle,
  criarEvento,
  remarcarEvento,
  tokenDeAcesso,
  type DadosDoEvento,
} from '../lib/google/calendario';
import type { ContextoTenant } from '../lib/auth/tenant';
import { DURACAO_PADRAO_MINUTOS } from '../lib/reunioes/status';
import { comTenant } from './contexto';
import { lerGoogleConectado, lerRefreshToken } from './google-config';

export type ResultadoMeet = { ok: true; meetUrl: string | null } | { ok: false; codigo: 'GOOGLE_NAO_CONECTADO' | 'REUNIAO_NAO_ENCONTRADA' | 'FALHA_NO_GOOGLE' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function tokenDaEmpresa(db: NodePgDatabase, empresaId: string): Promise<{ token: string; conta: string | null } | null> {
  const config = configDoGoogle();
  const refresh = config ? await lerRefreshToken(db, empresaId) : null;
  if (!config || !refresh) return null;
  const { conta } = await lerGoogleConectado(db, empresaId);
  return { token: await tokenDeAcesso(config, refresh), conta };
}

async function dadosDaReuniao(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>, id: string) {
  return comTenant(db, contexto, async (tx) => {
    const [l] = await tx
      .select({
        agendadaPara: reunioes.agendadaPara,
        eventoId: reunioes.calendarEventId,
        meetUrl: reunioes.meetUrl,
        leadNome: leads.nome,
        leadEmail: leads.email,
        closerNome: usuarios.nome,
        closerEmail: usuarios.email,
        oportunidadeId: reunioes.oportunidadeId,
      })
      .from(reunioes)
      .innerJoin(oportunidades, eq(reunioes.oportunidadeId, oportunidades.id))
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .where(and(eq(reunioes.id, id), eq(reunioes.empresaId, contexto.empresaId)))
      .limit(1);
    return l ?? null;
  });
}

function fimDe(inicio: Date): Date {
  return new Date(inicio.getTime() + DURACAO_PADRAO_MINUTOS * 60_000);
}

/** Cria o evento e a sala do Meet da reunião e guarda o link. Reunião que já tem sala devolve a que tem. */
export async function criarMeetDaReuniao(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>, id: string): Promise<ResultadoMeet> {
  try {
    const r = await dadosDaReuniao(db, contexto, id);
    if (!r) return { ok: false, codigo: 'REUNIAO_NAO_ENCONTRADA' };
    if (r.meetUrl) return { ok: true, meetUrl: r.meetUrl };
    const acesso = await tokenDaEmpresa(db, contexto.empresaId);
    if (!acesso) return { ok: false, codigo: 'GOOGLE_NAO_CONECTADO' };

    // O lead e o closer recebem o convite por e-mail; a conta conectada já é a dona do evento, então não se convida a si mesma.
    const convidados = [r.leadEmail, r.closerEmail]
      .filter((e): e is string => typeof e === 'string' && EMAIL.test(e))
      .filter((e, i, todos) => todos.indexOf(e) === i && e.toLowerCase() !== acesso.conta?.toLowerCase());
    const dados: DadosDoEvento = {
      titulo: `Demonstração MedGuia — ${r.leadNome}`,
      descricao: `Reunião comercial com ${r.leadNome}${r.closerNome ? `, conduzida por ${r.closerNome}` : ''}.`,
      inicio: r.agendadaPara,
      fim: fimDe(r.agendadaPara),
      convidados,
    };
    const evento = await criarEvento(acesso.token, dados, id);
    await comTenant(db, contexto, (tx) =>
      tx.update(reunioes).set({ calendarEventId: evento.id, meetUrl: evento.meetUrl }).where(and(eq(reunioes.id, id), eq(reunioes.empresaId, contexto.empresaId)))
    );
    return { ok: true, meetUrl: evento.meetUrl };
  } catch {
    return { ok: false, codigo: 'FALHA_NO_GOOGLE' };
  }
}

/** Quando a reunião muda de horário a sala é a mesma: o evento é movido e os convidados são avisados. */
export async function moverEventoDaReuniao(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>, id: string, novoInicio: Date): Promise<boolean> {
  try {
    const r = await dadosDaReuniao(db, contexto, id);
    if (!r?.eventoId) return false;
    const acesso = await tokenDaEmpresa(db, contexto.empresaId);
    if (!acesso) return false;
    await remarcarEvento(acesso.token, r.eventoId, novoInicio, fimDe(novoInicio));
    return true;
  } catch {
    return false;
  }
}

/** Apaga o evento do Calendar (a reunião foi cancelada). Sem evento ou sem Google, não há o que apagar. */
export async function apagarEventoDaReuniao(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>, eventoId: string | null): Promise<boolean> {
  if (!eventoId) return false;
  try {
    const acesso = await tokenDaEmpresa(db, contexto.empresaId);
    if (!acesso) return false;
    await apagarEvento(acesso.token, eventoId);
    return true;
  } catch {
    return false;
  }
}

/** O id do evento de uma reunião, para quem vai apagá-la saber qual evento tirar do Calendar. */
export async function eventoDaReuniao(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>, id: string): Promise<string | null> {
  const r = await dadosDaReuniao(db, contexto, id);
  return r?.eventoId ?? null;
}

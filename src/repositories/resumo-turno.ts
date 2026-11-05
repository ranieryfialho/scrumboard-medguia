// T-181 (fase4-tarefas-agenda, US-119/US-120): indicadores da fila do turno e
// das tarefas atrasadas (AC-462, AC-463, AC-473). O relógio é sempre recebido
// por parâmetro (ASM-062). Tudo é calculado em SQL, só da empresa da sessão
// (RLS + filtro explícito) e, se informado, só dos cards do responsável.
import { and, eq, gte, isNull, sql, type SQL } from 'drizzle-orm';

import { cadenciaAtividades, leads, oportunidades } from '../db/schema';
import { podeLiberar } from '../domain/cadencia/feriados';
import { dataLocalEmSaoPaulo, turnoVigente } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inicioDoTurnoDeReferencia } from './cadencia';
import { comTenant } from './contexto';

export interface ResumoTurno {
  turno: 'manha' | 'tarde' | null;
  toquesConcluidosTurno: number;
  toquesTotalTurno: number;
  conexoesHoje: number;
  semRespostaHoje: number;
  atrasados: number;
  /** Soma do valor dos cards (cada um uma vez) com ao menos um toque atrasado. */
  receitaSobRisco: number;
  cardsEmRisco: number;
  ticketMedio: number | null;
  maiorAtraso: { minutos: number; leadNome: string } | null;
  /** Toques de WhatsApp "aguardando resposta" (prazo ainda vigente): não contam como atrasados. */
  aguardandoResposta: number;
}

export async function resumoDoTurno(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: { responsavelId?: string; agora: Date }
): Promise<ResumoTurno> {
  const { agora } = filtro;
  const turno = podeLiberar(agora) ? turnoVigente(agora) : null;
  const corte = inicioDoTurnoDeReferencia(agora);
  const local = dataLocalEmSaoPaulo(agora);
  const inicioDoDia = new Date(Date.UTC(local.ano, local.mes - 1, local.dia, 3));
  const fimDoTurno = new Date(corte.getTime() + (local.hora < 13 ? 4 : 5) * 3600_000);

  return comTenant(db, contexto, async (tx) => {
    const base: SQL[] = [eq(cadenciaAtividades.empresaId, contexto.empresaId), eq(oportunidades.empresaId, contexto.empresaId)];
    if (filtro.responsavelId !== undefined) base.push(eq(oportunidades.responsavelId, filtro.responsavelId));

    const liberada = sql`"cadencia_atividades"."liberada_em"`;

    // Feitos hoje e feitos no turno vigente.
    const feitos = await tx
      .select({
        resultado: cadenciaAtividades.resultado,
        realizadaEm: cadenciaAtividades.realizadaEm,
      })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .where(and(...base, gte(cadenciaAtividades.realizadaEm, inicioDoDia)));

    let conexoesHoje = 0;
    let semRespostaHoje = 0;
    let concluidosTurno = 0;
    for (const f of feitos) {
      if (f.resultado === 'conectou') conexoesHoje += 1;
      else if (f.resultado === 'sem_resposta') semRespostaHoje += 1;
      else continue;
      const quando = f.realizadaEm?.getTime() ?? 0;
      if (turno && quando >= corte.getTime() && quando < fimDoTurno.getTime()) concluidosTurno += 1;
    }

    const pendentes = await tx
      .select({
        oportunidadeId: oportunidades.id,
        valor: oportunidades.valor,
        leadNome: leads.nome,
        liberadaEm: sql<string>`to_char(${liberada} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        aguardandoAte: cadenciaAtividades.aguardandoAte,
      })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .where(and(...base, eq(cadenciaAtividades.resultado, 'pendente'), isNull(oportunidades.cadenciaEncerradaEm)));

    let pendentesTurno = 0;
    let atrasados = 0;
    const cardsEmRisco = new Map<string, number>();
    let maior: { minutos: number; leadNome: string } | null = null;
    let aguardandoResposta = 0;
    for (const p of pendentes) {
      const liberada = new Date(p.liberadaEm).getTime();
      const aguardando = p.aguardandoAte !== null && p.aguardandoAte.getTime() > agora.getTime();
      if (aguardando) {
        // A mensagem já saiu e o toque espera o lead (ou o prazo): não é atraso, mas ainda é trabalho do turno.
        aguardandoResposta += 1;
        if (liberada >= corte.getTime() && turno) pendentesTurno += 1;
      } else if (liberada < corte.getTime()) {
        atrasados += 1;
        cardsEmRisco.set(p.oportunidadeId, p.valor === null ? 0 : Number(p.valor));
        const minutos = Math.floor((agora.getTime() - liberada) / 60_000);
        if (!maior || minutos > maior.minutos) maior = { minutos, leadNome: p.leadNome };
      } else if (turno) {
        pendentesTurno += 1;
      }
    }

    const receitaSobRisco = [...cardsEmRisco.values()].reduce((a, b) => a + b, 0);
    return {
      turno,
      toquesConcluidosTurno: concluidosTurno,
      toquesTotalTurno: turno ? concluidosTurno + pendentesTurno : 0,
      conexoesHoje,
      semRespostaHoje,
      atrasados,
      receitaSobRisco,
      cardsEmRisco: cardsEmRisco.size,
      ticketMedio: cardsEmRisco.size > 0 ? receitaSobRisco / cardsEmRisco.size : null,
      maiorAtraso: maior,
      aguardandoResposta,
    };
  });
}

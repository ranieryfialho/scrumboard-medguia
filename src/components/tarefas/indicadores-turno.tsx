// T-182 (fase4-tarefas-agenda, AC-462): os quatro cartões do topo da fila do
// turno — só o que o servidor calcula (`GET /api/atividades/resumo`).
import Link from 'next/link';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import type { ResumoDoTurno } from './comum';

export function IndicadoresTurno({ resumo }: { resumo: ResumoDoTurno }) {
  const { toquesConcluidosTurno: feitos, toquesTotalTurno: total } = resumo;
  const percentual = total > 0 ? Math.round((feitos / total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-1">
        <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Toques do turno</span>
        <span className="font-metric-stat text-metric-stat text-text-primary">
          {feitos} / {total} <span className="font-body-sm text-body-sm text-text-muted">concluídos</span>
        </span>
        <div
          role="progressbar"
          aria-valuenow={percentual}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 rounded-full bg-surface-container overflow-hidden"
        >
          <div className="h-full bg-primary" style={{ width: `${percentual}%` }} />
        </div>
        <span className="font-body-sm text-body-sm text-text-muted">{percentual}% do turno</span>
      </div>
      <CartaoIndicador titulo="Conexões efetivas hoje" valor={String(resumo.conexoesHoje)} legenda="toques com conexão" icone="call" cor="success" />
      <CartaoIndicador titulo="Sem resposta hoje" valor={String(resumo.semRespostaHoje)} legenda="toques sem resposta" icone="phone_missed" cor="warning" />
      <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-1">
        <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Atrasados</span>
        <span className="font-metric-stat text-metric-stat text-text-primary">{resumo.atrasados}</span>
        <Link href="/tarefas/atrasadas" className="font-label-md text-label-md font-semibold text-danger-text hover:underline">
          Ver {resumo.atrasados} tarefas atrasadas
        </Link>
      </div>
    </div>
  );
}

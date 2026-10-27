// T-173 (fase4-card-abas, US-113, AC-431): os quatro cartões do topo da tela de
// cadência — progresso, toque da vez, respostas obtidas e situação da régua.
// Fonte visual: `10._pipeline_id_cadencia_cad_ncia_do_card/`. Taxa de
// engajamento e SLA do protótipo não existem no sistema e não aparecem.
import { ROTULO_CANAL, ROTULO_SITUACAO, ROTULO_TURNO, type CadenciaDoCardView } from './tipos';

const COR_DA_SITUACAO: Record<CadenciaDoCardView['situacao'], string> = {
  nao_iniciada: 'text-text-muted',
  em_andamento: 'text-success-text',
  atrasada: 'text-danger-text',
  encerrada: 'text-text-secondary',
};

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-card rounded-xl p-space-md shadow-sm flex flex-col gap-2">
      <h3 className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

export function ResumoCadencia({ cadencia }: { cadencia: CadenciaDoCardView }) {
  const percentual = Math.round((cadencia.concluidos / cadencia.total) * 100);
  const vez = cadencia.toqueDaVez;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
      <Cartao titulo="Progresso Geral">
        <p className="font-headline-lg text-headline-lg text-text-primary">
          {cadencia.concluidos} <span className="font-body-md text-body-md text-text-secondary">/ {cadencia.total} toques</span>
        </p>
        <div
          role="progressbar"
          aria-label="Progresso da cadência"
          aria-valuemin={0}
          aria-valuemax={cadencia.total}
          aria-valuenow={cadencia.concluidos}
          className="w-full bg-surface-container h-2 rounded-full overflow-hidden"
        >
          <div className="bg-primary h-full rounded-full" style={{ width: `${percentual}%` }} />
        </div>
        <p className="font-body-sm text-body-sm text-text-muted">{cadencia.total - cadencia.concluidos} toques restantes</p>
      </Cartao>

      <Cartao titulo="Toque Atual">
        {vez ? (
          <>
            <p className="font-headline-md text-headline-md text-text-primary">Toque #{vez.sequencia}</p>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Dia {vez.dia} · Turno {ROTULO_TURNO[vez.turno]} · {ROTULO_CANAL[vez.canal]}
            </p>
          </>
        ) : (
          <p className="font-body-md text-body-md text-text-secondary">
            {cadencia.encerrada ? 'Cadência encerrada' : 'Nenhum toque liberado agora'}
          </p>
        )}
      </Cartao>

      <Cartao titulo="Respostas Obtidas">
        <p className="font-headline-lg text-headline-lg text-text-primary">
          {cadencia.conectou}{' '}
          <span className="font-body-md text-body-md text-text-secondary">{cadencia.conectou === 1 ? 'conexão' : 'conexões'}</span>
        </p>
        <p className="font-body-sm text-body-sm text-text-muted">{cadencia.semResposta} sem resposta</p>
      </Cartao>

      <Cartao titulo="Status da Régua">
        <p className={`font-headline-md text-headline-md ${COR_DA_SITUACAO[cadencia.situacao]}`}>
          {ROTULO_SITUACAO[cadencia.situacao]}
        </p>
      </Cartao>
    </div>
  );
}

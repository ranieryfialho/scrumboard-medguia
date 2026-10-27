// T-173 (fase4-card-abas, US-113, AC-432): a matriz dos 18 toques — 3 dias, cada
// um com os turnos Manhã e Tarde (3 toques por turno) e o estado de cada toque:
// concluído (com o resultado), toque da vez em destaque ou programado.
// Fonte visual: "Matriz Cadencial de 18 Toques" de `10._pipeline_id_cadencia_cad_ncia_do_card/`.
import { ROTULO_RESULTADO, ROTULO_TURNO, formatarDataHora, tituloDoToque, type ToqueDaCadencia } from './tipos';

const DIAS = [1, 2, 3] as const;
const TURNOS = ['manha', 'tarde'] as const;

function CartaoDoToque({ toque }: { toque: ToqueDaCadencia }) {
  const concluido = toque.estado === 'concluido';
  const daVez = toque.estado === 'da_vez';
  const classe = concluido
    ? 'bg-success-surface/50'
    : daVez
      ? 'bg-primary-fixed/40 ring-2 ring-primary'
      : 'bg-surface-subtle';

  return (
    <li data-estado={toque.estado} data-sequencia={toque.sequencia} className={`rounded-xl p-space-sm flex flex-col gap-1 ${classe}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-label-lg text-label-lg text-text-primary font-semibold">
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full bg-surface-card text-text-secondary flex items-center justify-center text-[11px] font-bold"
          >
            {toque.sequencia}
          </span>
          {tituloDoToque(toque)}
        </span>
        {concluido && toque.resultado && (
          <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm font-bold">
            {ROTULO_RESULTADO[toque.resultado]}
          </span>
        )}
        {daVez && (
          <span className="px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm font-bold">Toque da vez</span>
        )}
        {toque.estado === 'cancelado' && (
          <span className="px-2 py-0.5 rounded-full bg-surface-container text-text-muted font-label-sm text-label-sm font-bold">Cancelado</span>
        )}
        {toque.estado === 'programado' && (
          <span className="font-label-sm text-label-sm text-text-muted">Programado</span>
        )}
        {toque.atrasado && (
          <span className="px-2 py-0.5 rounded bg-danger-surface text-danger-text font-label-sm text-label-sm font-bold">Atrasado</span>
        )}
      </div>
      {concluido && toque.realizadaEm && (
        <p className="font-body-sm text-body-sm text-text-secondary">
          Executado: {formatarDataHora(toque.realizadaEm)}
          {toque.realizadaPor ? ` · ${toque.realizadaPor.nome}` : ''}
        </p>
      )}
      {toque.observacao && <p className="font-body-sm text-body-sm text-text-muted">“{toque.observacao}”</p>}
    </li>
  );
}

export function MatrizToques({ toques }: { toques: ToqueDaCadencia[] }) {
  return (
    <section aria-label="Matriz de 18 toques" className="flex flex-col gap-space-md">
      <div>
        <h2 className="font-headline-md text-headline-md text-text-primary">Matriz Cadencial de 18 Toques</h2>
        <p className="font-body-sm text-body-sm text-text-secondary">
          Régua em 3 dias, com janelas de turno matutino e vespertino.
        </p>
      </div>

      {DIAS.map((dia) => {
        const doDia = toques.filter((toque) => toque.dia === dia);
        const feitos = doDia.filter((toque) => toque.estado === 'concluido').length;
        return (
          <div key={dia} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-sm text-headline-sm text-text-primary">Dia {dia}</h3>
              <span className="font-label-md text-label-md text-text-secondary">
                {feitos}/{doDia.length} concluídos
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
              {TURNOS.map((turno) => {
                const doTurno = doDia.filter((toque) => toque.turno === turno);
                const primeiro = doTurno[0]?.sequencia;
                const ultimo = doTurno[doTurno.length - 1]?.sequencia;
                return (
                  <div key={turno} className="flex flex-col gap-2">
                    <h4 className="font-label-lg text-label-lg text-text-secondary font-semibold">
                      Turno {ROTULO_TURNO[turno]} (Toques {primeiro} a {ultimo})
                    </h4>
                    <ul className="flex flex-col gap-2">
                      {doTurno.map((toque) => (
                        <CartaoDoToque key={toque.sequencia} toque={toque} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// T-186 (fase4-tarefas-agenda, AC-484): as quatro visões do calendário — Lista,
// Dia, Semana e Mês — sobre as reuniões que o servidor devolveu para o período.
import { CartaoReuniao, SeloStatus, type AcoesDaReuniao } from './cartao-reuniao';
import { DIAS_DA_SEMANA, diaDe, diasDoPeriodo, horaDe, inicioDaSemana, periodoDaVisao, rotuloDoDia } from './datas';
import type { ReuniaoView } from './tipos';

interface ComumProps {
  reunioes: ReuniaoView[];
  acoes: AcoesDaReuniao;
  ocupado: boolean;
}

function Vazio() {
  return <p className="font-body-md text-body-md text-text-secondary py-space-md">Nenhuma reunião neste período</p>;
}

export function VisaoLista({ reunioes, acoes, ocupado }: ComumProps) {
  if (reunioes.length === 0) return <Vazio />;
  return (
    <div className="flex flex-col gap-space-sm">
      {reunioes.map((r) => (
        <div key={r.id} className="flex flex-col gap-1">
          <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">{rotuloDoDia(diaDe(r.agendadaPara))}</span>
          <CartaoReuniao reuniao={r} acoes={acoes} ocupado={ocupado} />
        </div>
      ))}
    </div>
  );
}

export function VisaoDia({ reunioes, acoes, ocupado }: ComumProps) {
  if (reunioes.length === 0) return <Vazio />;
  return (
    <div className="flex flex-col gap-space-sm">
      {reunioes.map((r) => (
        <CartaoReuniao key={r.id} reuniao={r} acoes={acoes} ocupado={ocupado} />
      ))}
    </div>
  );
}

export function VisaoSemana({ reunioes, referencia, hoje }: { reunioes: ReuniaoView[]; referencia: string; hoje: string }) {
  const dias = diasDoPeriodo(inicioDaSemana(referencia), 7);
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2" data-visao="semana">
      {dias.map((dia, i) => {
        const doDia = reunioes.filter((r) => diaDe(r.agendadaPara) === dia);
        return (
          <section key={dia} aria-label={`${DIAS_DA_SEMANA[i]} ${dia.slice(8)}`} className={`rounded-xl p-2 min-h-24 ${dia === hoje ? 'bg-info-surface' : 'bg-surface-subtle'}`}>
            <h3 className="font-label-md text-label-md text-text-primary mb-1">
              {DIAS_DA_SEMANA[i]} {dia.slice(8)}
            </h3>
            {doDia.length === 0 && <p className="font-body-sm text-body-sm text-text-muted">—</p>}
            <ul className="flex flex-col gap-1">
              {doDia.map((r) => (
                <li key={r.id} className="bg-surface-card rounded-lg p-1.5 font-body-sm text-body-sm">
                  <span className="font-label-md text-label-md text-primary">{horaDe(r.agendadaPara)}</span> {r.lead.nome}
                  <div className="mt-0.5">
                    <SeloStatus status={r.status} comIcone={false} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function VisaoMes({
  reunioes,
  referencia,
  hoje,
  onEscolherDia,
}: {
  reunioes: ReuniaoView[];
  referencia: string;
  hoje: string;
  onEscolherDia: (dia: string) => void;
}) {
  const { de } = periodoDaVisao('mes', referencia);
  const dias = diasDoPeriodo(de, 42);
  const mesAtual = referencia.slice(0, 7);
  const contagem = new Map<string, number>();
  for (const r of reunioes) contagem.set(diaDe(r.agendadaPara), (contagem.get(diaDe(r.agendadaPara)) ?? 0) + 1);

  return (
    <div data-visao="mes">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DIAS_DA_SEMANA.map((d) => (
          <span key={d} className="font-label-sm text-label-sm text-text-muted uppercase text-center">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((dia) => {
          const quantidade = contagem.get(dia) ?? 0;
          const doMes = dia.startsWith(mesAtual);
          return (
            <button
              key={dia}
              type="button"
              onClick={() => onEscolherDia(dia)}
              aria-label={`${rotuloDoDia(dia)}${quantidade ? `, ${quantidade} ${quantidade === 1 ? 'reunião' : 'reuniões'}` : ''}`}
              className={`h-16 rounded-lg p-1.5 text-left flex flex-col justify-between ${doMes ? 'bg-surface-subtle' : 'bg-surface-card opacity-60'} ${dia === hoje ? 'ring-2 ring-primary' : ''}`}
            >
              <span className="font-label-md text-label-md text-text-primary">{Number(dia.slice(8))}</span>
              {quantidade > 0 && (
                <span className="self-start px-1.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm">{quantidade}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

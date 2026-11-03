// T-299 (fase4-tarefas-agenda, US-120, AC-763): os quatro cartões do topo de "Tarefas Atrasadas", no desenho do protótipo
// (`14._tarefas_atrasadas_toques_vencidos/`): rótulo pequeno, ícone num quadrado colorido, número grande, uma linha de explicação e,
// embaixo de um traço, um dado de apoio. Só entram números que o sistema tem: o "SLA recuperado hoje" do protótipo não existe aqui, e
// o quarto cartão é "Cards em risco" (quantos cards têm toque atrasado). Os números vêm do resumo do servidor (`/api/atividades/resumo`).
import { moeda, textoDoAtraso, type ResumoDoTurno } from './comum';

interface KpisAtrasadosProps {
  resumo: ResumoDoTurno | null;
  /** Toques atrasados da fila carregada, usado quando o resumo ainda não chegou. */
  total: number;
  /** Como a fila abaixo está ordenada, para o rodapé do cartão do maior atraso. */
  ordem: 'maior' | 'menor';
}

interface CartaoProps {
  rotulo: string;
  icone: string;
  corDoIcone: string;
  destaque?: boolean;
  valor: React.ReactNode;
  etiqueta?: React.ReactNode;
  explicacao: string;
  rodape?: { rotulo: string; valor: string };
}

function Cartao({ rotulo, icone, corDoIcone, destaque = false, valor, etiqueta, explicacao, rodape }: CartaoProps) {
  return (
    <div
      className={`rounded-2xl p-space-md shadow-sm flex flex-col gap-2 min-h-[11rem] ${
        destaque ? 'bg-surface-card ring-1 ring-danger-text/30' : 'bg-surface-card'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">{rotulo}</span>
        <span aria-hidden="true" className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${corDoIcone}`}>
          <span className="material-symbols-outlined text-[22px]">{icone}</span>
        </span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        {valor}
        {etiqueta}
      </div>
      <p className="font-body-sm text-body-sm text-text-muted">{explicacao}</p>
      {rodape && (
        <div className="mt-auto pt-2 border-t border-surface-container flex items-center justify-between gap-2 font-body-sm text-body-sm">
          <span className="text-text-muted">{rodape.rotulo}</span>
          <span className="font-label-md text-label-md text-text-primary text-right">{rodape.valor}</span>
        </div>
      )}
    </div>
  );
}

export function KpisAtrasados({ resumo, total, ordem }: KpisAtrasadosProps) {
  const atrasados = resumo?.atrasados ?? total;
  const cards = resumo?.cardsEmRisco ?? 0;
  const maior = resumo?.maiorAtraso ?? null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md flex-shrink-0">
      <Cartao
        rotulo="Toques atrasados"
        icone="alarm"
        corDoIcone="bg-danger-surface text-danger-text"
        destaque={atrasados > 0}
        valor={<span className="font-metric-stat text-metric-stat text-text-primary">{atrasados}</span>}
        etiqueta={
          <span
            className={`px-2 py-0.5 rounded font-label-sm text-label-sm font-bold ${
              atrasados > 0 ? 'bg-danger-surface text-danger-text' : 'bg-success-surface text-success-text'
            }`}
          >
            {atrasados > 0 ? 'Crítico' : 'Em dia'}
          </span>
        }
        explicacao="Cadências bloqueadas sem interação"
        rodape={{ rotulo: 'Cards afetados:', valor: String(cards) }}
      />
      <Cartao
        rotulo="Receita (MRR) sob risco"
        icone="paid"
        corDoIcone="bg-warning-surface text-warning-text"
        valor={
          <span className="font-metric-stat text-metric-stat text-text-primary">
            {moeda(resumo?.receitaSobRisco ?? 0)} <span className="font-body-sm text-body-sm text-text-muted">/mês</span>
          </span>
        }
        explicacao={cards > 0 ? `Valor somado de ${cards} ${cards === 1 ? 'card parado' : 'cards parados'}` : 'Nenhum card com toque parado'}
        rodape={{ rotulo: 'Ticket médio em risco:', valor: resumo?.ticketMedio != null ? `${moeda(resumo.ticketMedio)} / card` : '—' }}
      />
      <Cartao
        rotulo="Maior tempo de atraso"
        icone="hourglass_top"
        corDoIcone="bg-danger-surface text-danger-text"
        valor={<span className="font-metric-stat text-metric-stat text-danger-text">{maior ? textoDoAtraso(maior.minutos) : '—'}</span>}
        explicacao={maior?.leadNome ?? 'Nada atrasado no momento'}
        rodape={{ rotulo: 'Fila ordenada por:', valor: ordem === 'maior' ? 'maior atraso primeiro' : 'menor atraso primeiro' }}
      />
      <Cartao
        rotulo="Cards em risco"
        icone="groups"
        corDoIcone="bg-info-surface text-primary"
        valor={<span className="font-metric-stat text-metric-stat text-text-primary">{cards}</span>}
        explicacao="Cards com ao menos um toque atrasado"
        rodape={{ rotulo: 'Toques atrasados por card:', valor: cards > 0 ? (atrasados / cards).toFixed(1).replace('.', ',') : '—' }}
      />
    </div>
  );
}

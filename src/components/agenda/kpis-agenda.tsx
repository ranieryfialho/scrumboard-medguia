// T-300 (fase4-tarefas-agenda, US-121, AC-764): os quatro cartões do topo da agenda no desenho do protótipo
// (`15._agenda_calend_rio_e_gest_o_de_no_show/`): rótulo, selo no canto, número grande, uma linha de apoio e uma barra de
// progresso embaixo. Só números que o sistema tem (o resumo da semana) — "+4,5%" e "15,8% semana" do protótipo, que comparam
// com a semana anterior, não existem aqui.
import type { SeloMeta } from '@/lib/metas/catalogo';
import type { ResumoAgendaView } from './tipos';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface CartaoProps {
  titulo: string;
  selo?: { texto: string; classe: string };
  valor: string;
  unidade?: string;
  legenda: string;
  meta?: SeloMeta | null;
  barra?: { percentual: number; classe: string };
}

function Cartao({ titulo, selo, valor, unidade, legenda, meta, barra }: CartaoProps) {
  return (
    <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-1 min-h-[9.5rem]">
      <div className="flex items-start justify-between gap-2">
        <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">{titulo}</span>
        {selo && <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ${selo.classe}`}>{selo.texto}</span>}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="font-metric-stat text-metric-stat text-text-primary">{valor}</span>
        {unidade && <span className="font-headline-sm text-headline-sm text-text-secondary">{unidade}</span>}
      </div>
      <span className="font-body-sm text-body-sm text-text-muted">{legenda}</span>
      {meta && (
        <span className="flex items-center gap-2 font-body-sm text-body-sm text-text-muted">
          {meta.texto}
          {meta.atingida && <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">Meta atingida</span>}
        </span>
      )}
      <div className="mt-auto pt-2">
        {barra ? (
          <div className="h-1.5 rounded-full bg-surface-container overflow-hidden" role="presentation">
            <div className={`h-full rounded-full ${barra.classe}`} style={{ width: `${Math.min(100, Math.max(0, barra.percentual))}%` }} />
          </div>
        ) : (
          <div className="h-1.5" />
        )}
      </div>
    </div>
  );
}

export function KpisAgenda({ resumo, metaPresenca }: { resumo: ResumoAgendaView; metaPresenca: SeloMeta | null }) {
  const { hoje, presenca, noShow, pipelineEmDemonstracao: pipeline } = resumo;
  const feitasHoje = hoje.total > 0 ? ((hoje.total - hoje.emAndamentoOuPorVir) / hoje.total) * 100 : 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <Cartao
        titulo="Reuniões agendadas hoje"
        selo={{ texto: 'Hoje', classe: 'bg-info-surface text-info-text' }}
        valor={String(hoje.total)}
        legenda={`${hoje.emAndamentoOuPorVir} em andamento / próximas`}
        barra={{ percentual: feitasHoje, classe: 'bg-primary' }}
      />
      <Cartao
        titulo="Taxa de presença"
        valor={presenca.taxa === null ? '—' : `${presenca.taxa}%`}
        legenda={`${presenca.realizadas} realizadas na semana`}
        meta={metaPresenca}
        barra={{ percentual: presenca.taxa ?? 0, classe: 'bg-success-text' }}
      />
      <Cartao
        titulo="Ocorrências de no-show"
        selo={noShow.quantidade > 0 ? { texto: 'Atenção', classe: 'bg-danger-surface text-danger-text' } : undefined}
        valor={String(noShow.quantidade)}
        unidade={noShow.quantidade === 1 ? 'clínica' : 'clínicas'}
        legenda={noShow.percentual === null ? 'Sem reuniões com resultado na semana' : `${noShow.percentual}% na semana`}
        barra={{ percentual: noShow.percentual ?? 0, classe: 'bg-danger-text' }}
      />
      <Cartao
        titulo="Pipeline em demonstração"
        valor={MOEDA.format(pipeline.valor)}
        legenda={`${pipeline.contas} ${pipeline.contas === 1 ? 'conta' : 'contas'}`}
        barra={undefined}
      />
    </div>
  );
}

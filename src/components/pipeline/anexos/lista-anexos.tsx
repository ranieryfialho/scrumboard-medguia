// T-172 (fase4-card-abas, US-112, AC-424/AC-426/AC-429): as linhas da lista de
// anexos do card — ícone do tipo, nome, selo de evidência (só quando o anexo foi
// usado numa mudança de etapa), tamanho, quem enviou, data e início do hash.
// Fonte visual: uma linha de `12._pipeline_id_anexos_prints_e_evid_ncias_do_card/`.
// Os selos "aprovada/em revisão/válida" do protótipo não existem no sistema e
// não aparecem; "Tornar Evidência" e desvincular ficam "em breve" (AC-429).
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import {
  formatarDataHora,
  formatarTamanho,
  hashAbreviado,
  nomeParaExibir,
  tipoDoAnexo,
  type AnexoDaLista,
} from './formatos';

function IconeDoTipo({ mime }: { mime: string }) {
  const pdf = tipoDoAnexo(mime) === 'pdf';
  return (
    <div
      aria-hidden="true"
      className={`w-14 h-16 rounded-lg flex flex-col items-center justify-center shrink-0 shadow-sm ${
        pdf ? 'bg-danger-surface/50 text-danger-text' : 'bg-info-surface text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-[28px]">{pdf ? 'description' : 'image'}</span>
      <span className="font-label-sm text-[9px] font-bold tracking-wider mt-0.5 uppercase">{pdf ? 'PDF' : 'IMG'}</span>
    </div>
  );
}

export function LinhaDeAnexo({ anexo }: { anexo: AnexoDaLista }) {
  const nome = nomeParaExibir(anexo);
  const href = `/api/anexos/${anexo.id}`;

  return (
    <div className="bg-surface-card rounded-xl p-space-md shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-space-md">
      <div className="flex items-start gap-space-md flex-1 min-w-0">
        <IconeDoTipo mime={anexo.mime} />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-headline-sm text-headline-sm text-text-primary font-semibold truncate">{nome}</h3>
            {anexo.evidencia && (
              <span className="px-2.5 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm font-bold flex items-center gap-1">
                <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                  verified
                </span>
                Evidência · {anexo.evidencia.etapaNome}
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-surface-subtle text-text-muted font-label-sm text-label-sm">
              {formatarTamanho(anexo.tamanho)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text-secondary font-body-sm text-body-sm">
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-text-muted">
                person
              </span>
              {anexo.enviadoPorNome ?? 'Autor desconhecido'}
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="material-symbols-outlined text-[15px] text-text-muted">
                schedule
              </span>
              {formatarDataHora(anexo.criadoEm)}
            </span>
            <span className="text-text-muted">| SHA-256: {hashAbreviado(anexo.hash)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir por link seguro de curta duração"
          className="px-3 py-1.5 rounded-lg bg-info-surface text-primary hover:bg-primary hover:text-on-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 transition-all"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            visibility
          </span>
          Link Seguro (15m)
        </a>
        <a
          href={href}
          download
          title="Baixar"
          aria-label={`Baixar ${nome}`}
          className="p-2 rounded-lg bg-surface-subtle text-text-secondary hover:text-text-primary hover:bg-surface-container-high transition-colors"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            download
          </span>
        </a>
        {!anexo.evidencia && (
          <ItemEmBreve rotulo="Tornar Evidência" className="px-2.5 py-1.5 rounded-lg bg-surface-subtle" />
        )}
        <ItemEmBreve rotulo="Excluir" icone="link_off" className="px-2.5 py-1.5 rounded-lg bg-surface-subtle" />
      </div>
    </div>
  );
}

export function ListaAnexos({ anexos }: { anexos: AnexoDaLista[] }) {
  return (
    <div className="flex flex-col gap-space-sm">
      {anexos.map((anexo) => (
        <LinhaDeAnexo key={anexo.id} anexo={anexo} />
      ))}
    </div>
  );
}

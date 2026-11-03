'use client';

// T-172 (fase4-card-abas, US-112, AC-424/AC-426; T-294 AC-752 a AC-755): as linhas da lista de
// anexos do card — ícone do tipo, nome, selo de evidência (anexo usado numa mudança de
// etapa ou marcado por "Tornar Evidência"), tamanho, quem enviou, data e início do hash.
// Fonte visual: uma linha de `12._pipeline_id_anexos_prints_e_evid_ncias_do_card/`.
// Os selos "aprovada/em revisão/válida" do protótipo não existem no sistema e
// não aparecem. "Tornar Evidência", "Remover evidência" e "Excluir" (com confirmação) funcionam.
import { useState } from 'react';

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

const MENSAGENS_DE_ERRO: Record<string, string> = {
  SEM_PERMISSAO: 'Só quem enviou o anexo ou um gerente pode excluí-lo.',
  ANEXO_E_EVIDENCIA: 'Este anexo é evidência de uma etapa. Remova a evidência antes de excluir.',
  ANEXO_NAO_ENCONTRADO: 'Este anexo não existe mais.',
};

export function LinhaDeAnexo({ anexo, onMudou }: { anexo: AnexoDaLista; onMudou?: () => void }) {
  const nome = nomeParaExibir(anexo);
  const href = `/api/anexos/${anexo.id}`;
  const [trabalhando, setTrabalhando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /** AC-752 a AC-754: chama a rota, mostra o motivo se recusar e, se der certo, pede à tela para reler a lista. */
  async function chamar(url: string, metodo: 'POST' | 'DELETE') {
    setTrabalhando(true);
    setErro(null);
    try {
      const resposta = await fetch(url, { method: metodo });
      if (resposta.ok) {
        setConfirmando(false);
        onMudou?.();
        return;
      }
      const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
      setErro(MENSAGENS_DE_ERRO[corpo?.codigo ?? ''] ?? 'Não foi possível concluir. Tente de novo.');
      setConfirmando(false);
    } catch {
      setErro('Não foi possível concluir. Tente de novo.');
      setConfirmando(false);
    } finally {
      setTrabalhando(false);
    }
  }

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
        {anexo.evidencia ? (
          <button
            type="button"
            disabled={trabalhando}
            onClick={() => void chamar(`/api/anexos/${anexo.id}/evidencia`, 'DELETE')}
            className="px-2.5 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface-container-high font-label-md text-label-md text-text-secondary flex items-center gap-1.5 transition-colors disabled:opacity-60"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              remove_done
            </span>
            Remover evidência
          </button>
        ) : (
          <button
            type="button"
            disabled={trabalhando}
            onClick={() => void chamar(`/api/anexos/${anexo.id}/evidencia`, 'POST')}
            title="Marcar como evidência da etapa atual do card"
            className="px-2.5 py-1.5 rounded-lg bg-surface-subtle hover:bg-surface-container-high font-label-md text-label-md text-text-primary flex items-center gap-1.5 transition-colors disabled:opacity-60"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              verified
            </span>
            Tornar Evidência
          </button>
        )}
        {anexo.podeExcluir && (
          <button
            type="button"
            disabled={trabalhando || anexo.evidencia !== null}
            onClick={() => setConfirmando(true)}
            title={anexo.evidencia ? 'Remova a evidência antes de excluir' : 'Excluir anexo'}
            aria-label={`Excluir ${nome}`}
            className="px-2.5 py-1.5 rounded-lg bg-surface-subtle hover:bg-danger-surface hover:text-danger-text font-label-md text-label-md text-text-primary flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:hover:bg-surface-subtle disabled:hover:text-text-primary"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
              delete
            </span>
            Excluir
          </button>
        )}
      </div>
      {erro && (
        <p role="alert" className="basis-full font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          {erro}
        </p>
      )}
      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby={`excluir-${anexo.id}`}>
          <div className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-space-lg flex flex-col gap-space-md">
            <h2 id={`excluir-${anexo.id}`} className="font-headline-sm text-headline-sm text-text-primary">
              Excluir este anexo?
            </h2>
            <p className="font-body-md text-body-md text-text-secondary">
              <strong className="text-text-primary break-all">{nome}</strong> será apagado do servidor e não poderá ser recuperado. A exclusão fica registrada na linha do tempo do card.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmando(false)} disabled={trabalhando} className="h-10 px-4 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void chamar(`/api/anexos/${anexo.id}`, 'DELETE')}
                disabled={trabalhando}
                className="h-10 px-4 rounded-xl bg-danger-text text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-60"
              >
                {trabalhando ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ListaAnexos({ anexos, onMudou }: { anexos: AnexoDaLista[]; onMudou?: () => void }) {
  return (
    <div className="flex flex-col gap-space-sm">
      {anexos.map((anexo) => (
        <LinhaDeAnexo key={anexo.id} anexo={anexo} onMudou={onMudou} />
      ))}
    </div>
  );
}

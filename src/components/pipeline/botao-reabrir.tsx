'use client';

// T-162 (fase4-pipeline-telas, US-108, AC-404): "Reabrir" um card
// arquivado — pede a justificativa (obrigatória) e chama
// `POST /api/oportunidades/[id]/reabrir` (T-156), que já faz a checagem de
// papel por cima do grafo (só MASTER/GERENTE, 403 para o resto; a prova de
// que a API recusa é do teste de T-156,
// `test/api/pipeline-escrita.test.ts`). Aqui só a UI: o botão fica
// desabilitado (sem `onClick`) para quem a tela sabe que não pode
// (`podeReabrir`, decidido por quem usa este componente a partir de
// `GET /api/me`). A rota de reabrir exige a `version` atual da linha (lock
// otimista, T-045); como a listagem de arquivados (`listarArquivados`,
// T-154) não expõe esse campo, a versão fresca é buscada em
// `GET /api/oportunidades/[id]` só na hora de confirmar — evita carregar
// `version` em toda a tabela sem necessidade.
import { useState } from 'react';

interface BotaoReabrirProps {
  oportunidadeId: string;
  leadNome: string;
  podeReabrir: boolean;
  /** Chamado depois que a API confirma a reabertura, para a tela recarregar a lista, as contagens e os indicadores. */
  onReaberto: () => void;
}

export function BotaoReabrir({ oportunidadeId, leadNome, podeReabrir, onReaberto }: BotaoReabrirProps) {
  const [aberto, setAberto] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!podeReabrir) {
    return (
      <div
        role="button"
        aria-disabled="true"
        aria-label={`Reabrir ${leadNome} (apenas Master ou Gerente)`}
        className="inline-flex px-2.5 py-1.5 rounded-lg bg-surface-subtle text-text-muted font-label-md text-label-md items-center gap-1 cursor-not-allowed"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
          restart_alt
        </span>
        <span>Reabrir</span>
      </div>
    );
  }

  function abrirModal() {
    setJustificativa('');
    setErro(null);
    setAberto(true);
  }

  async function confirmar() {
    if (!justificativa.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      const respostaAtual = await fetch(`/api/oportunidades/${oportunidadeId}`);
      if (!respostaAtual.ok) throw new Error('não foi possível ler o card');
      const atual = (await respostaAtual.json()) as { version: number };

      const respostaReabrir = await fetch(`/api/oportunidades/${oportunidadeId}/reabrir`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: atual.version, justificativa }),
      });
      if (!respostaReabrir.ok) throw new Error('não foi possível reabrir o card');

      setAberto(false);
      onReaberto();
    } catch {
      setErro('Não foi possível reabrir o card. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrirModal}
        className="inline-flex px-2.5 py-1.5 rounded-lg bg-info-surface text-info-text hover:bg-info-border font-label-md text-label-md items-center gap-1 transition-colors"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
          restart_alt
        </span>
        <span>Reabrir</span>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-surface-card rounded-2xl p-space-lg w-full max-w-md shadow-2xl relative flex flex-col gap-space-md">
            <h4 className="font-headline-sm text-headline-sm text-text-primary">Reabrir {leadNome}</h4>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Ao reabrir, este card volta ao funil ativo.
            </p>
            <label
              htmlFor={`justificativa-reabrir-${oportunidadeId}`}
              className="font-label-md text-label-md text-text-primary font-semibold"
            >
              Justificativa (obrigatória)
            </label>
            <textarea
              id={`justificativa-reabrir-${oportunidadeId}`}
              value={justificativa}
              onChange={(evento) => setJustificativa(evento.target.value)}
              rows={2}
              className="w-full p-2.5 rounded-lg bg-surface-subtle text-text-primary font-body-sm text-body-sm focus:outline-none"
            />
            {erro && <p className="font-body-sm text-body-sm text-danger-text">{erro}</p>}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="px-4 py-2 rounded-lg bg-surface-card hover:bg-surface-subtle text-text-secondary font-label-lg text-label-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={!justificativa.trim() || enviando}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg shadow-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirmar e Reabrir
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

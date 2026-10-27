'use client';

// T-174 (fase4-card-abas, US-114, AC-443): a coluna da direita da conversa —
// "Cadência Comercial" (toque da vez e progresso, de `GET .../cadencia`) e
// "Notas Internas" (as anotações do card, de `GET .../linha-do-tempo?tipo=anotacao`,
// e o campo que grava uma nova por `POST .../anotacoes`). "Dados da Proposta" e
// "Qualificação Técnica" do protótipo não existem no sistema e não aparecem.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  ROTULO_CANAL,
  ROTULO_TURNO,
  formatarDataHora,
  type CadenciaDoCardView,
} from '@/components/pipeline/cadencia/tipos';

interface Nota {
  id: string;
  texto: string | null;
  autorNome: string | null;
  ocorridoEm: string;
}

export function PainelLateral({ cardId }: { cardId: string }) {
  const [cadencia, setCadencia] = useState<CadenciaDoCardView | null>(null);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [novaNota, setNovaNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregarNotas = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/oportunidades/${cardId}/linha-do-tempo?tipo=anotacao`);
      if (!resposta.ok) return;
      const corpo = (await resposta.json()) as { itens: Nota[] };
      setNotas(corpo.itens);
    } catch {
      // Sem conectividade: mantém as notas como estavam.
    }
  }, [cardId]);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/oportunidades/${cardId}/cadencia`)
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: CadenciaDoCardView | null) => {
        if (!cancelado) setCadencia(corpo);
      })
      .catch(() => undefined);
    void carregarNotas();
    return () => {
      cancelado = true;
    };
  }, [cardId, carregarNotas]);

  async function salvarNota() {
    const texto = novaNota.trim();
    if (!texto) return;
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/oportunidades/${cardId}/anotacoes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto }),
      });
      if (!resposta.ok) throw new Error(`anotações respondeu ${resposta.status}`);
      setNovaNota('');
      await carregarNotas();
    } catch {
      setErro('Não foi possível salvar a nota. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const vez = cadencia?.toqueDaVez ?? null;

  return (
    <aside aria-label="Painel do card" className="flex flex-col gap-space-md">
      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
        <h3 className="font-headline-sm text-headline-sm text-text-primary">Cadência Comercial</h3>
        {cadencia && cadencia.iniciada ? (
          <>
            <p className="font-body-md text-body-md text-text-secondary">
              Toque atual:{' '}
              <strong className="text-text-primary">
                {vez ? `#${vez.sequencia} · Dia ${vez.dia}, ${ROTULO_TURNO[vez.turno]} (${ROTULO_CANAL[vez.canal]})` : 'nenhum liberado'}
              </strong>
            </p>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Progresso: {cadencia.concluidos} de {cadencia.total} toques
            </p>
            <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden" aria-hidden="true">
              <div className="bg-primary h-full" style={{ width: `${Math.round((cadencia.concluidos / cadencia.total) * 100)}%` }} />
            </div>
            <Link href={`/pipeline/${cardId}/cadencia`} className="font-label-md text-label-md text-primary hover:underline w-fit">
              Ver a cadência completa
            </Link>
          </>
        ) : (
          <p className="font-body-sm text-body-sm text-text-muted">A cadência deste card ainda não foi iniciada.</p>
        )}
      </section>

      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-headline-sm text-headline-sm text-text-primary">Notas Internas</h3>
          <span className="px-2 py-0.5 rounded bg-warning-surface text-warning-text font-label-sm text-label-sm font-bold uppercase">
            Privado
          </span>
        </div>
        <p className="font-body-sm text-body-sm text-text-secondary">
          Visíveis apenas para a equipe comercial: não aparecem no WhatsApp do cliente.
        </p>

        {notas.length === 0 ? (
          <p className="font-body-sm text-body-sm text-text-muted">Nenhuma nota ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notas.map((nota) => (
              <li key={nota.id} className="bg-surface-subtle rounded-lg p-space-sm flex flex-col gap-1">
                <div className="flex items-center justify-between font-label-sm text-label-sm">
                  <span className="text-primary font-semibold">{nota.autorNome ?? 'Sistema'}</span>
                  <span className="text-text-muted">{formatarDataHora(nota.ocorridoEm)}</span>
                </div>
                <p className="font-body-md text-body-md text-text-primary whitespace-pre-wrap">{nota.texto}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={novaNota}
            onChange={(evento) => setNovaNota(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') {
                evento.preventDefault();
                void salvarNota();
              }
            }}
            placeholder="Adicionar nota interna rápida..."
            aria-label="Adicionar nota interna rápida"
            className="flex-1 h-10 px-3 rounded-lg bg-surface-subtle font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={() => void salvarNota()}
            disabled={salvando || novaNota.trim() === ''}
            aria-label="Salvar nota interna"
            className="h-10 w-10 rounded-lg bg-primary text-on-primary flex items-center justify-center disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
              add
            </span>
          </button>
        </div>
        {erro && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text">
            {erro}
          </p>
        )}
      </section>
    </aside>
  );
}

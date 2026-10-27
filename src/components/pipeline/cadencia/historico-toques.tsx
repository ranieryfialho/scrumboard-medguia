'use client';

// T-173 (fase4-card-abas, US-113, AC-435/AC-436): "Histórico Consolidado de
// Interações da Régua" — os toques já feitos, do mais novo ao mais antigo, com
// o filtro por canal e o atalho "Ver conversa" nos de WhatsApp. "Exportar
// Relatório (PDF)" não tem backend e fica "em breve".
import { useMemo, useState } from 'react';
import Link from 'next/link';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { ROTULO_CANAL, ROTULO_RESULTADO, ROTULO_TURNO, formatarDataHora, type ToqueDaCadencia } from './tipos';

type FiltroCanal = 'todos' | ToqueDaCadencia['canal'];

export function HistoricoToques({ cardId, toques }: { cardId: string; toques: ToqueDaCadencia[] }) {
  const [canal, setCanal] = useState<FiltroCanal>('todos');

  const feitos = useMemo(
    () =>
      toques
        .filter((toque) => toque.estado === 'concluido' && toque.realizadaEm)
        .sort((a, b) => new Date(b.realizadaEm!).getTime() - new Date(a.realizadaEm!).getTime()),
    [toques]
  );
  const visiveis = canal === 'todos' ? feitos : feitos.filter((toque) => toque.canal === canal);

  return (
    <section aria-label="Histórico de interações da régua" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <div>
          <h2 className="font-headline-md text-headline-md text-text-primary">Histórico Consolidado de Interações da Régua</h2>
          <p className="font-body-sm text-body-sm text-text-secondary">Os toques já feitos neste card.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <label className="flex items-center gap-2 font-body-sm text-body-sm text-text-secondary">
            Filtrar por canal
            <select
              value={canal}
              onChange={(evento) => setCanal(evento.target.value as FiltroCanal)}
              className="h-9 px-2 rounded-lg bg-surface-subtle text-text-primary font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="todos">Todos</option>
              <option value="telefone">{ROTULO_CANAL.telefone}</option>
              <option value="whatsapp">{ROTULO_CANAL.whatsapp}</option>
            </select>
          </label>
          <ItemEmBreve rotulo="Exportar Relatório (PDF)" icone="picture_as_pdf" className="h-9 px-3 rounded-lg bg-surface-subtle" />
        </div>
      </div>

      {visiveis.length === 0 ? (
        <p className="font-body-md text-body-md text-text-muted">
          {feitos.length === 0 ? 'Nenhum toque feito ainda.' : 'Nenhum toque feito neste canal.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
                <th className="py-2 pr-4">Toque</th>
                <th className="py-2 pr-4">Canal</th>
                <th className="py-2 pr-4">Executado por</th>
                <th className="py-2 pr-4">Quando</th>
                <th className="py-2 pr-4">Resultado</th>
                <th className="py-2">Ação</th>
              </tr>
            </thead>
            <tbody className="font-body-md text-body-md text-text-primary">
              {visiveis.map((toque) => (
                <tr key={toque.sequencia} className="border-t border-border-subtle">
                  <td className="py-2 pr-4">
                    #{toque.sequencia} · Dia {toque.dia} ({ROTULO_TURNO[toque.turno]})
                  </td>
                  <td className="py-2 pr-4">{ROTULO_CANAL[toque.canal]}</td>
                  <td className="py-2 pr-4">{toque.realizadaPor?.nome ?? '—'}</td>
                  <td className="py-2 pr-4">{formatarDataHora(toque.realizadaEm!)}</td>
                  <td className="py-2 pr-4">{toque.resultado ? ROTULO_RESULTADO[toque.resultado] : '—'}</td>
                  <td className="py-2">
                    {toque.canal === 'whatsapp' ? (
                      <Link href={`/pipeline/${cardId}/conversa`} className="text-primary font-semibold hover:underline">
                        Ver conversa
                      </Link>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

'use client';

// T-253 (fase5-whatsapp-lote-disparo, US-165, AC-686): acompanhamento dos lotes de WhatsApp — progresso, contagens,
// destinatários de cada lote e "Cancelar envio" nos em andamento. Atualiza sozinha a cada 10 s enquanto houver lote em
// andamento. Só gerente+ (a API e o menu já barram os demais).
import { useCallback, useEffect, useState } from 'react';

import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';

interface Lote {
  id: string;
  templateNome: string;
  criadoPorNome: string | null;
  status: 'em_andamento' | 'concluido' | 'cancelado';
  total: number;
  criadoEm: string;
  enviados: number;
  falhas: number;
  pendentes: number;
  cancelados: number;
}
interface Item {
  id: string;
  nome: string;
  telefone: string;
  status: 'pendente' | 'enviando' | 'enviado' | 'falhou' | 'cancelado';
  erro: string | null;
}

const SITUACAO: Record<Lote['status'], { rotulo: string; cor: string }> = {
  em_andamento: { rotulo: 'Em andamento', cor: 'bg-info-surface text-info-text' },
  concluido: { rotulo: 'Concluído', cor: 'bg-success-surface text-success-text' },
  cancelado: { rotulo: 'Cancelado', cor: 'bg-surface-container text-text-muted' },
};
const ITEM: Record<Item['status'], string> = { pendente: 'Na fila', enviando: 'Enviando', enviado: 'Enviado', falhou: 'Falhou', cancelado: 'Cancelado' };
const MOTIVO: Record<string, string> = {
  NUMERO_SEM_WHATSAPP: 'número sem WhatsApp',
  FALHA_ENVIO: 'falha no envio',
  WHATSAPP_NAO_CONFIGURADO: 'WhatsApp não configurado',
  SEM_CONSENTIMENTO: 'consentimento revogado',
  LOTE_CANCELADO: 'lote cancelado',
};
const INTERVALO_DA_ATUALIZACAO_MS = 10_000;

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function Lotes() {
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [erro, setErro] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/whatsapp/lote');
      if (!r?.ok) throw new Error(`lotes respondeu ${r?.status}`);
      setLotes(((await r.json()) as { lotes: Lote[] }).lotes);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  const carregarItens = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/whatsapp/lote/${id}`);
      if (r?.ok) setItens(((await r.json()) as { itens: Item[] }).itens);
    } catch {
      // mantém o que já estava na tela
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const haEmAndamento = lotes?.some((l) => l.status === 'em_andamento') ?? false;
  useEffect(() => {
    if (!haEmAndamento) return;
    const timer = setInterval(() => {
      void carregar();
      if (aberto) void carregarItens(aberto);
    }, INTERVALO_DA_ATUALIZACAO_MS);
    return () => clearInterval(timer);
  }, [haEmAndamento, aberto, carregar, carregarItens]);

  async function alternar(id: string) {
    if (aberto === id) return setAberto(null);
    setAberto(id);
    setItens([]);
    await carregarItens(id);
  }

  async function cancelar(id: string) {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/whatsapp/lote/${id}/cancelar`, { method: 'POST' });
      if (!r?.ok) {
        const e = (await r.json().catch(() => null)) as { codigo?: string } | null;
        setAviso({ ok: false, texto: e?.codigo === 'LOTE_ENCERRADO' ? 'Este lote já terminou.' : 'Não foi possível cancelar o lote. Tente de novo.' });
      } else {
        setAviso({ ok: true, texto: 'Envio cancelado. O que já saiu não é desfeito.' });
      }
      await carregar();
      if (aberto === id) await carregarItens(id);
    } catch {
      setAviso({ ok: false, texto: 'Não foi possível falar com o servidor. Tente de novo.' });
    } finally {
      setTrabalhando(false);
    }
  }

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary">Envio em Lote</h1>
        <p className="font-body-md text-body-md text-text-secondary max-w-2xl">Os disparos de WhatsApp em lote. As mensagens saem uma de cada vez, com 15 a 45 segundos entre elas. Para disparar, selecione os cards na Lista do pipeline.</p>
      </div>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
        </p>
      )}
      {erro && <EstadoErro mensagem="Não foi possível carregar os lotes." onTentarDeNovo={() => void carregar()} />}
      {!erro && !lotes && <EsqueletoCarregando />}
      {lotes && lotes.length === 0 && <EstadoVazio titulo="Nenhum lote ainda" proximoPasso="selecione cards na Lista do pipeline e use Disparar WhatsApp" icone="send" />}

      {lotes && lotes.length > 0 && (
        <section aria-label="Lotes" className="flex flex-col gap-space-sm">
          {lotes.map((l) => {
            const feitos = l.enviados + l.falhas + l.cancelados;
            const percentual = Math.round((feitos / l.total) * 100);
            return (
              <article key={l.id} aria-label={`Lote ${l.templateNome}`} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">{l.templateNome}</h2>
                  <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${SITUACAO[l.status].cor}`}>{SITUACAO[l.status].rotulo}</span>
                </div>
                <p className="font-body-sm text-body-sm text-text-muted">
                  {dataHora(l.criadoEm)}
                  {l.criadoPorNome ? ` · por ${l.criadoPorNome}` : ''} · {l.total} {l.total === 1 ? 'destinatário' : 'destinatários'}
                </p>
                <div role="progressbar" aria-valuenow={percentual} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso do lote ${l.templateNome}`} className="h-2 rounded-full bg-surface-container overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${percentual}%` }} />
                </div>
                <p className="font-body-md text-body-md text-text-secondary">
                  {l.enviados} enviados · {l.falhas} falhas · {l.pendentes} na fila · {l.cancelados} cancelados
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => void alternar(l.id)} aria-label={`${aberto === l.id ? 'Ocultar' : 'Ver'} destinatários: ${l.templateNome}`} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                    {aberto === l.id ? 'Ocultar destinatários' : 'Ver destinatários'}
                  </button>
                  {l.status === 'em_andamento' && (
                    <button type="button" disabled={trabalhando} onClick={() => void cancelar(l.id)} aria-label={`Cancelar envio: ${l.templateNome}`} className="h-9 px-3 rounded-lg bg-danger-surface font-label-md text-label-md font-semibold text-danger-text disabled:opacity-50">
                      Cancelar envio
                    </button>
                  )}
                </div>
                {aberto === l.id && (
                  <ul aria-label="Destinatários" className="flex flex-col gap-1 max-h-72 overflow-y-auto">
                    {itens.map((i) => (
                      <li key={i.id} className="rounded-lg bg-surface-subtle px-3 py-2 flex items-center justify-between gap-2 font-body-sm text-body-sm">
                        <span className="text-text-primary">
                          {i.nome} <span className="text-text-muted">· {i.telefone}</span>
                        </span>
                        <span className={i.status === 'falhou' ? 'text-danger-text' : 'text-text-secondary'}>
                          {ITEM[i.status]}
                          {i.erro ? ` (${MOTIVO[i.erro] ?? i.erro})` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

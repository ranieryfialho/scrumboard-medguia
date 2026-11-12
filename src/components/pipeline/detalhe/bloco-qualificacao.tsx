'use client';

// fase6-qualificacao-comercial (US-198, AC-832/AC-833): o bloco "Qualificação" do detalhe do card — seis critérios pontuados, três
// eliminatórios e o estágio profissional, com nota, faixa e recomendação calculados na hora (mesmo domínio do servidor). "Salvar" grava
// a avaliação no card; ao reabrir, as respostas voltam preenchidas.
import { useCallback, useEffect, useState } from 'react';

import {
  BLOQUEIOS,
  CRITERIOS,
  ESTAGIOS,
  RESPOSTAS_VAZIAS,
  TEXTO_NAO_INICIADA,
  calcularQualificacao,
  type ChaveDoBloqueio,
  type ChaveDoCriterio,
  type ChaveDoEstagio,
  type FaixaDeQualificacao,
  type RespostasDaQualificacao,
} from '@/domain/qualificacao/qualificacao';
import { COR_DA_FAIXA } from '@/components/pipeline/pecas/selo-qualificacao';

interface QualificacaoRecebida {
  respostas: RespostasDaQualificacao;
  bloqueios: ChaveDoBloqueio[];
  estagio: ChaveDoEstagio | null;
  faixa: FaixaDeQualificacao | null;
  avaliadoPor: string | null;
  atualizadoEm: string | null;
}

const COR_DA_BARRA: Record<FaixaDeQualificacao, string> = { A: '#159d72', B: '#2563eb', C: '#d97706', baixo: '#64748b', revisao: '#d97706' };

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function BlocoQualificacao({ oportunidadeId, aoSalvar }: { oportunidadeId: string; aoSalvar?: () => void }) {
  const [respostas, setRespostas] = useState<RespostasDaQualificacao>({ ...RESPOSTAS_VAZIAS });
  const [bloqueios, setBloqueios] = useState<ChaveDoBloqueio[]>([]);
  const [estagio, setEstagio] = useState<ChaveDoEstagio | null>(null);
  const [avaliacao, setAvaliacao] = useState<{ por: string | null; em: string | null }>({ por: null, em: null });
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [alterado, setAlterado] = useState(false);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch(`/api/oportunidades/${oportunidadeId}/qualificacao`);
      if (!r.ok) throw new Error(String(r.status));
      const dados = (await r.json()) as QualificacaoRecebida;
      setRespostas(dados.respostas);
      setBloqueios(dados.bloqueios);
      setEstagio(dados.estagio);
      setAvaliacao({ por: dados.avaliadoPor, em: dados.atualizadoEm });
      setAlterado(false);
      setEstado('pronto');
    } catch {
      setEstado('erro');
    }
  }, [oportunidadeId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resultado = calcularQualificacao({ respostas, bloqueios, estagio });

  async function salvar() {
    setSalvando(true);
    setMensagem(null);
    try {
      const r = await fetch(`/api/oportunidades/${oportunidadeId}/qualificacao`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respostas, bloqueios, estagio }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const dados = (await r.json()) as QualificacaoRecebida;
      setAvaliacao({ por: dados.avaliadoPor, em: dados.atualizadoEm });
      setAlterado(false);
      setMensagem({ tipo: 'ok', texto: 'Qualificação salva.' });
      aoSalvar?.();
    } catch {
      setMensagem({ tipo: 'erro', texto: 'Não foi possível salvar. Tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  function responder(chave: ChaveDoCriterio, valor: string) {
    setRespostas((atual) => ({ ...atual, [chave]: valor === '' ? null : Number(valor) }));
    setAlterado(true);
  }

  function alternarBloqueio(chave: ChaveDoBloqueio) {
    setBloqueios((atual) => (atual.includes(chave) ? atual.filter((b) => b !== chave) : [...atual, chave]));
    setAlterado(true);
  }

  const cor = resultado.faixa ? COR_DA_BARRA[resultado.faixa] : '#64748b';

  return (
    <section aria-label="Qualificação" className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
      <div className="flex items-center justify-between gap-2 pb-space-sm border-b border-border-subtle">
        <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-primary">
            fact_check
          </span>
          Qualificação
        </h2>
      </div>

      {estado === 'carregando' && <p className="font-body-sm text-body-sm text-text-muted">Carregando…</p>}
      {estado === 'erro' && (
        <p className="font-body-sm text-body-sm text-danger-text">
          Não foi possível carregar a qualificação.{' '}
          <button type="button" onClick={() => void carregar()} className="underline font-semibold">
            Tentar de novo
          </button>
        </p>
      )}

      {estado === 'pronto' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-space-lg items-start">
          <div className="flex flex-col gap-space-md">
            <div className="flex flex-col gap-space-sm">
              {CRITERIOS.map((c, i) => (
                <label key={c.chave} className="flex flex-col gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-label-md text-label-md text-text-primary">
                      {i + 1}. {c.nome}
                    </span>
                    <span className="font-label-sm text-label-sm text-primary whitespace-nowrap">
                      {respostas[c.chave] ?? 0}/{c.max} pontos
                    </span>
                  </span>
                  <span className="font-body-sm text-body-sm text-text-muted">{c.dica}</span>
                  <select
                    aria-label={c.nome}
                    value={respostas[c.chave] === null ? '' : String(respostas[c.chave])}
                    onChange={(e) => responder(c.chave, e.target.value)}
                    className="w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2 font-body-md text-body-md text-text-primary"
                  >
                    <option value="">Selecione uma resposta</option>
                    {c.opcoes.map((o) => (
                      <option key={o.rotulo} value={o.pontos}>
                        {o.rotulo} · {o.pontos} pts
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-label-md text-label-md text-text-primary">Critérios eliminatórios</legend>
              <span className="font-body-sm text-body-sm text-text-muted">Marque somente com confirmação. Uma incompatibilidade real prevalece sobre a nota.</span>
              {BLOQUEIOS.map((b) => (
                <label key={b.chave} className="flex items-start gap-2 font-body-sm text-body-sm text-text-primary">
                  <input type="checkbox" checked={bloqueios.includes(b.chave)} onChange={() => alternarBloqueio(b.chave)} className="mt-0.5 accent-primary" />
                  <span>{b.rotulo}</span>
                </label>
              ))}
            </fieldset>
          </div>

          <div className="flex flex-col gap-space-md lg:sticky lg:top-space-md">
            <div role="status" aria-label="Resultado da qualificação" className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-2">
              <div className="flex items-end justify-between gap-2">
                <span className="font-headline-md text-headline-md text-text-primary">
                  <span data-testid="nota">{resultado.score}</span>
                  <span className="font-body-md text-body-md text-text-muted">/100</span>
                </span>
                <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${resultado.faixa ? COR_DA_FAIXA[resultado.faixa] : 'bg-surface-container text-text-secondary'}`}>{resultado.rotulo}</span>
              </div>
              <div className="h-2.5 rounded-full bg-surface-card overflow-hidden" aria-hidden="true">
                <div className="h-full rounded-full transition-all" style={{ width: `${resultado.score}%`, background: cor }} />
              </div>
              <span className="font-label-lg text-label-lg text-text-primary">{resultado.titulo}</span>
              <p className="font-body-sm text-body-sm text-text-secondary">{resultado.faixa ? resultado.recomendacao : TEXTO_NAO_INICIADA.recomendacao}</p>
              <span className="font-body-sm text-body-sm text-text-muted">Jornada: {resultado.jornada}</span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-label-md text-label-md text-text-primary">Estágio profissional / do consultório</span>
              <select
                value={estagio ?? ''}
                onChange={(e) => {
                  setEstagio(e.target.value === '' ? null : (e.target.value as ChaveDoEstagio));
                  setAlterado(true);
                }}
                className="w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2 font-body-md text-body-md text-text-primary"
              >
                <option value="">Selecione o estágio</option>
                {ESTAGIOS.map((e) => (
                  <option key={e.chave} value={e.chave}>
                    {e.rotulo}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={salvando || !alterado}
                className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-lg text-label-lg disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : 'Salvar qualificação'}
              </button>
              <span className="font-body-sm text-body-sm text-text-muted">
                {avaliacao.em ? `Avaliado${avaliacao.por ? ` por ${avaliacao.por}` : ''} em ${dataHora(avaliacao.em)}` : 'Ainda não salva neste card'}
              </span>
              {mensagem && (
                <p role="status" className={`font-body-sm text-body-sm ${mensagem.tipo === 'ok' ? 'text-success-text' : 'text-danger-text'}`}>
                  {mensagem.texto}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

'use client';

// T-221 (fase5-metas, US-144): tela de metas dos indicadores. O catálogo é fixo (`src/lib/metas/catalogo.ts`): cinco
// metas em porcentagem e, desde a fase5-meta-receita, a receita mensal em reais (AC-687); campo vazio = sem meta (AC-618).
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CATALOGO_METAS, formatarAlvo, metaValida, type ChaveMeta, type UnidadeMeta } from '@/lib/metas/catalogo';
import { EsqueletoCarregando, EstadoErro } from './estados';
import { AvisoConfig, CabecalhoConfig, CLASSE_CAMPO, SecaoConfig } from './pecas-config';

interface Detalhe {
  chave: ChaveMeta;
  valor: number;
  atualizadoEm: string;
  atualizadoPorNome: string | null;
}

/** O valor gravado como aparece no campo: "25" para porcentagem, "50.000,00" para reais. */
function paraCampo(valor: number, unidade: UnidadeMeta): string {
  return unidade === 'reais' ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(valor).replace('.', ',');
}

/** O que foi digitado como número: em reais, o ponto é milhar (`50.000,50`); em porcentagem só a vírgula decimal. */
function lerCampo(texto: string, unidade: UnidadeMeta): number {
  const limpo = texto.trim();
  return Number(unidade === 'reais' ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(',', '.'));
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

export function Metas() {
  const [detalhes, setDetalhes] = useState<Detalhe[] | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const aplicar = (lista: Detalhe[]) => {
    setDetalhes(lista);
    setCampos(Object.fromEntries(lista.map((d) => [d.chave, paraCampo(d.valor, CATALOGO_METAS.find((m) => m.chave === d.chave)?.unidade ?? 'porcentagem')])));
  };

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/metas');
      if (!r.ok) throw new Error(`metas respondeu ${r.status}`);
      aplicar(((await r.json()) as { detalhes: Detalhe[] }).detalhes);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    const metas: Record<string, number | null> = {};
    for (const { chave, rotulo, unidade } of CATALOGO_METAS) {
      const texto = (campos[chave] ?? '').trim();
      if (texto === '') {
        metas[chave] = null;
        continue;
      }
      const numero = lerCampo(texto, unidade);
      if (!metaValida(chave, numero)) {
        setAviso({
          ok: false,
          texto: unidade === 'reais' ? `${rotulo}: a meta deve ser um valor de R$ 0,01 a R$ 99.999.999,99, com até duas casas.` : `${rotulo}: a meta deve ser um número de 0,1 a 100, com até uma casa decimal.`,
        });
        return;
      }
      metas[chave] = numero;
    }
    setTrabalhando(true);
    try {
      const r = await fetch('/api/metas', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metas }) });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { mensagem?: string } | null;
        setAviso({ ok: false, texto: corpo?.mensagem ?? 'Não foi possível salvar as metas.' });
        return;
      }
      aplicar(((await r.json()) as { detalhes: Detalhe[] }).detalhes);
      setAviso({ ok: true, texto: 'Meta salva' });
    } finally {
      setTrabalhando(false);
    }
  }

  const areas = Array.from(new Set(CATALOGO_METAS.map((m) => m.area)));
  const ICONE_DA_AREA: Record<string, string> = { Pipeline: 'filter_alt', Agenda: 'event', 'E-mail': 'mail', Comercial: 'payments' };
  const definidas = detalhes?.length ?? 0;

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <CabecalhoConfig
        titulo="Metas"
        descricao="Defina o resultado esperado de cada indicador. As telas mostram a meta e avisam quando ela é atingida."
        acoes={
          detalhes && (
            <span className="h-10 px-4 rounded-xl bg-surface-card shadow-sm flex items-center gap-2 font-label-md text-label-md text-text-primary">
              <span aria-hidden="true" className="material-symbols-outlined text-[19px] text-primary">flag</span>
              {definidas} de {CATALOGO_METAS.length} metas definidas
            </span>
          )
        }
      />

      {erro && <EstadoErro mensagem="Não foi possível carregar as metas." onTentarDeNovo={() => void carregar()} />}
      {!erro && !detalhes && <EsqueletoCarregando />}

      {detalhes && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md xl:items-start">
            {areas.map((area) => (
              <SecaoConfig key={area} nome={area} rotulo="Indicadores" titulo={area} icone={ICONE_DA_AREA[area] ?? 'flag'}>
                <div className="flex flex-col">
                  {CATALOGO_METAS.filter((m) => m.area === area).map((m) => {
                    const atual = detalhes.find((d) => d.chave === m.chave);
                    return (
                      <div key={m.chave} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border-subtle py-space-sm first:border-t-0 first:pt-0 last:pb-0">
                        <div className="flex flex-col min-w-0">
                          <label htmlFor={`meta-${m.chave}`} className="font-label-md text-label-md text-text-primary">
                            {m.rotulo}
                          </label>
                          <span className="font-body-sm text-body-sm text-text-muted">{m.ajuda}</span>
                          <span className="font-body-sm text-body-sm text-text-secondary mt-0.5">
                            {atual ? `${formatarAlvo(atual.valor, m.unidade)}${atual.atualizadoPorNome ? ` · ${atual.atualizadoPorNome}` : ''} · ${dataHora(atual.atualizadoEm)}` : 'Sem meta'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {m.unidade === 'reais' && <span className="font-label-md text-label-md text-text-muted">R$</span>}
                          <input
                            id={`meta-${m.chave}`}
                            inputMode="decimal"
                            value={campos[m.chave] ?? ''}
                            onChange={(e) => setCampos({ ...campos, [m.chave]: e.target.value })}
                            placeholder="Sem meta"
                            className={`${CLASSE_CAMPO} w-36 text-right`}
                          />
                          {m.unidade === 'porcentagem' && <span className="font-label-md text-label-md text-text-muted">%</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SecaoConfig>
            ))}
          </div>
          <div className="bg-surface-card rounded-2xl shadow-sm p-space-md flex items-center gap-3 flex-wrap">
            <Button type="button" disabled={trabalhando} onClick={() => void salvar()}>
              Salvar metas
            </Button>
            <span className="font-body-sm text-body-sm text-text-muted">Campo em branco = sem meta para o indicador.</span>
            {aviso && <AvisoConfig ok={aviso.ok}>{aviso.texto}</AvisoConfig>}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

// T-221 (fase5-metas, US-144): tela de metas dos indicadores. O catálogo é fixo (cinco metas em
// porcentagem, `src/lib/metas/catalogo.ts`); campo vazio = sem meta (AC-618).
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CATALOGO_METAS, type ChaveMeta } from '@/lib/metas/catalogo';
import { EsqueletoCarregando, EstadoErro } from './estados';

interface Detalhe {
  chave: ChaveMeta;
  valor: number;
  atualizadoEm: string;
  atualizadoPorNome: string | null;
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
    setCampos(Object.fromEntries(lista.map((d) => [d.chave, String(d.valor).replace('.', ',')])));
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
    for (const { chave, rotulo } of CATALOGO_METAS) {
      const texto = (campos[chave] ?? '').trim().replace(',', '.');
      if (texto === '') {
        metas[chave] = null;
        continue;
      }
      const numero = Number(texto);
      if (!Number.isFinite(numero) || numero < 0.1 || numero > 100 || Math.abs(numero * 10 - Math.round(numero * 10)) > 1e-9) {
        setAviso({ ok: false, texto: `${rotulo}: a meta deve ser um número de 0,1 a 100, com até uma casa decimal.` });
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

  return (
    <div className="flex flex-col gap-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary">Metas</h1>
        <p className="font-body-md text-body-md text-text-muted">Defina o resultado esperado de cada indicador. As telas mostram a meta e avisam quando ela é atingida.</p>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível carregar as metas." onTentarDeNovo={() => void carregar()} />}
      {!erro && !detalhes && <EsqueletoCarregando />}

      {detalhes && (
        <>
          {areas.map((area) => (
            <section key={area} aria-label={area} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">{area}</h2>
              {CATALOGO_METAS.filter((m) => m.area === area).map((m) => {
                const atual = detalhes.find((d) => d.chave === m.chave);
                return (
                  <div key={m.chave} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-border-subtle pt-space-sm first:border-t-0 first:pt-0">
                    <div className="flex flex-col">
                      <label htmlFor={`meta-${m.chave}`} className="font-label-md text-label-md text-text-primary">
                        {m.rotulo}
                      </label>
                      <span className="font-body-sm text-body-sm text-text-muted">{m.ajuda}</span>
                      <span className="font-body-sm text-body-sm text-text-muted">
                        {atual ? `${String(atual.valor).replace('.', ',')}%${atual.atualizadoPorNome ? ` · ${atual.atualizadoPorNome}` : ''} · ${dataHora(atual.atualizadoEm)}` : 'Sem meta'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id={`meta-${m.chave}`}
                        inputMode="decimal"
                        value={campos[m.chave] ?? ''}
                        onChange={(e) => setCampos({ ...campos, [m.chave]: e.target.value })}
                        placeholder="Sem meta"
                        className="h-10 w-28 rounded-xl border border-border-subtle bg-surface-card px-3 text-right"
                      />
                      <span className="font-body-md text-body-md text-text-muted">%</span>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
          <div className="flex items-center gap-3 flex-wrap">
            <Button type="button" disabled={trabalhando} onClick={() => void salvar()}>
              Salvar metas
            </Button>
            {aviso && (
              <span role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md ${aviso.ok ? 'text-success-text' : 'text-danger-text'}`}>
                {aviso.texto}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

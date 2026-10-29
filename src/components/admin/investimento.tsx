'use client';

// T-226 (fase5-investimento-midia, US-147): tela de investimento em mídia por canal e mês. Campo vazio
// remove o investimento do canal (AC-630); canal novo entra pelo campo "Novo canal" (AC-631).
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { chaveDoCanal, normalizarCanal, valorValido } from '@/lib/investimento/calculo';
import { EsqueletoCarregando, EstadoErro } from './estados';

interface Canal {
  canal: string;
  valor: number | null;
}
interface Resposta {
  mes: string;
  canais: Canal[];
  total: number;
}

function mesAtual(): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
  return partes.slice(0, 7);
}
function somarMeses(mes: string, delta: number): string {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function rotuloDoMes(mes: string): string {
  return new Date(`${mes}-01T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const paraTexto = (valor: number | null) => (valor === null ? '' : valor.toFixed(2).replace('.', ','));

export function Investimento() {
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<string[]>([]);
  const [novoCanal, setNovoCanal] = useState('');
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const aplicar = (r: Resposta) => {
    setDados(r);
    setCampos(Object.fromEntries(r.canais.map((c) => [c.canal, paraTexto(c.valor)])));
    setExtras([]);
  };

  const carregar = useCallback(async () => {
    setDados(null);
    try {
      const r = await fetch(`/api/investimento?mes=${mes}`);
      if (!r.ok) throw new Error(`investimento respondeu ${r.status}`);
      aplicar((await r.json()) as Resposta);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [mes]);

  useEffect(() => {
    setAviso(null);
    void carregar();
  }, [carregar]);

  function adicionarCanal() {
    const nome = normalizarCanal(novoCanal);
    if (!nome) {
      setAviso({ ok: false, texto: 'O nome do canal deve ter de 2 a 60 caracteres.' });
      return;
    }
    const existente = [...(dados?.canais.map((c) => c.canal) ?? []), ...extras].find((c) => chaveDoCanal(c) === chaveDoCanal(nome));
    if (!existente) {
      setExtras([...extras, nome]);
      setCampos({ ...campos, [nome]: '' });
    }
    setNovoCanal('');
    setAviso(null);
  }

  async function salvar() {
    const valores: Record<string, number | null> = {};
    for (const canal of [...(dados?.canais.map((c) => c.canal) ?? []), ...extras]) {
      const texto = (campos[canal] ?? '').trim().replace(/\./g, '').replace(',', '.');
      if (texto === '') {
        valores[canal] = null;
        continue;
      }
      const numero = Number(texto);
      if (!valorValido(numero)) {
        setAviso({ ok: false, texto: `${canal}: o investimento deve ser um valor em reais de R$ 0,01 a R$ 9.999.999,99, com até duas casas.` });
        return;
      }
      valores[canal] = numero;
    }
    setTrabalhando(true);
    try {
      const r = await fetch('/api/investimento', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mes, valores }) });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { mensagem?: string } | null;
        setAviso({ ok: false, texto: corpo?.mensagem ?? 'Não foi possível salvar o investimento.' });
        return;
      }
      aplicar((await r.json()) as Resposta);
      setAviso({ ok: true, texto: 'Investimento salvo' });
    } finally {
      setTrabalhando(false);
    }
  }

  const linhas = [...(dados?.canais.map((c) => c.canal) ?? []), ...extras];

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary">Investimento em Mídia</h1>
        <p className="font-body-md text-body-md text-text-muted">Quanto foi investido em cada canal no mês. O relatório de marketing usa estes valores para calcular custo por lead, CAC e ROAS.</p>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))} className="h-10 w-10 rounded-xl bg-surface-card shadow-sm">
          <span aria-hidden="true" className="material-symbols-outlined">chevron_left</span>
        </button>
        <span role="status" aria-label="Mês" className="min-w-40 text-center font-label-lg text-label-lg capitalize text-text-primary">{rotuloDoMes(mes)}</span>
        <button type="button" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))} className="h-10 w-10 rounded-xl bg-surface-card shadow-sm">
          <span aria-hidden="true" className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível carregar o investimento." onTentarDeNovo={() => void carregar()} />}
      {!erro && !dados && <EsqueletoCarregando />}

      {dados && (
        <>
          <section aria-label="Canais do mês" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            {linhas.length === 0 && <p className="font-body-md text-body-md text-text-muted">Nenhum canal ainda. Adicione um canal abaixo.</p>}
            {linhas.map((canal) => (
              <div key={canal} className="flex items-center justify-between gap-2 border-t border-border-subtle pt-space-sm first:border-t-0 first:pt-0">
                <label htmlFor={`inv-${canal}`} className="font-label-md text-label-md text-text-primary">{canal}</label>
                <div className="flex items-center gap-2">
                  <span className="font-body-md text-body-md text-text-muted">R$</span>
                  <input
                    id={`inv-${canal}`}
                    inputMode="decimal"
                    value={campos[canal] ?? ''}
                    onChange={(e) => setCampos({ ...campos, [canal]: e.target.value })}
                    placeholder="Sem investimento"
                    className="h-10 w-40 rounded-xl border border-border-subtle bg-surface-card px-3 text-right"
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-border-subtle pt-space-sm">
              <input
                aria-label="Novo canal"
                value={novoCanal}
                onChange={(e) => setNovoCanal(e.target.value)}
                placeholder="Novo canal (ex.: TikTok Ads)"
                className="h-10 flex-1 rounded-xl border border-border-subtle bg-surface-card px-3"
              />
              <Button type="button" variant="outline" onClick={adicionarCanal}>
                Adicionar canal
              </Button>
            </div>
          </section>

          <div className="flex items-center gap-3 flex-wrap">
            <Button type="button" disabled={trabalhando} onClick={() => void salvar()}>
              Salvar investimento
            </Button>
            <span className="font-label-lg text-label-lg text-text-primary">Total do mês: {moeda(dados.total)}</span>
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

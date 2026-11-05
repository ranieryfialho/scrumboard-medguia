'use client';

// Responsável padrão dos cards novos (migration 0036): quem recebe, por padrão, os cards que nascem sem responsável — a closer da equipe,
// por exemplo. A escolha vale na hora para tudo que for criado (novo lead, planilha, formulário, WhatsApp). "Aplicar" leva o padrão
// também aos cards que já estão sem responsável.
import { useCallback, useEffect, useState } from 'react';

interface Estado {
  responsavelId: string | null;
  responsaveis: { id: string; nome: string; papel: string }[];
  semResponsavel: number;
}

export function ResponsavelPadrao() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [escolhido, setEscolhido] = useState('');
  const [trabalhando, setTrabalhando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/equipe/responsavel-padrao');
      if (!r.ok) throw new Error(String(r.status));
      const e = (await r.json()) as Estado;
      setEstado(e);
      setEscolhido(e.responsavelId ?? '');
    } catch {
      setEstado(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar() {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch('/api/equipe/responsavel-padrao', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ responsavelId: escolhido === '' ? null : escolhido }) });
      if (!r.ok) throw new Error(String(r.status));
      setEstado((await r.json()) as Estado);
      setAviso({ ok: true, texto: escolhido === '' ? 'Sem responsável padrão: os cards novos entram sem responsável.' : 'Salvo. Os cards novos passam a entrar com essa pessoa.' });
    } catch {
      setAviso({ ok: false, texto: 'Não foi possível salvar. Tente de novo.' });
    } finally {
      setTrabalhando(false);
    }
  }

  async function aplicar() {
    setTrabalhando(true);
    setAviso(null);
    setConfirmando(false);
    try {
      const r = await fetch('/api/equipe/responsavel-padrao', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aplicar: true }) });
      if (!r.ok) throw new Error(String(r.status));
      const corpo = (await r.json()) as Estado & { aplicados: number; falhas: number };
      setEstado(corpo);
      setAviso({ ok: corpo.falhas === 0, texto: `${corpo.aplicados} cards passaram para o responsável padrão${corpo.falhas ? ` (${corpo.falhas} falharam)` : ''}.` });
    } catch {
      setAviso({ ok: false, texto: 'Não foi possível aplicar. Escolha e salve o responsável padrão antes.' });
    } finally {
      setTrabalhando(false);
    }
  }

  if (!estado) return null;
  const mudou = escolhido !== (estado.responsavelId ?? '');
  const nomeDoPadrao = estado.responsaveis.find((r) => r.id === estado.responsavelId)?.nome;

  return (
    <section aria-label="Responsável padrão dos cards" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-3 flex-wrap shrink-0">
      <div className="flex flex-col mr-2">
        <span className="font-label-lg text-label-lg text-text-primary font-semibold">Responsável padrão dos cards novos</span>
        <span className="font-body-sm text-body-sm text-text-muted">Quem recebe os cards que entram sem responsável (planilha, formulário, WhatsApp, novo lead).</span>
      </div>
      <select aria-label="Responsável padrão" value={escolhido} disabled={trabalhando} onChange={(e) => setEscolhido(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle min-w-56">
        <option value="">Ninguém (entram sem responsável)</option>
        {estado.responsaveis.map((r) => (
          <option key={r.id} value={r.id}>
            {r.nome} · {r.papel}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => void salvar()} disabled={trabalhando || !mudou} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50">
        Salvar
      </button>
      {estado.responsavelId && estado.semResponsavel > 0 && !mudou && (
        <>
          {confirmando ? (
            <span className="flex items-center gap-2 font-body-sm text-body-sm text-text-secondary">
              Passar {estado.semResponsavel} cards para {nomeDoPadrao}?
              <button type="button" onClick={() => void aplicar()} disabled={trabalhando} className="h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold">
                Confirmar
              </button>
              <button type="button" onClick={() => setConfirmando(false)} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md">
                Cancelar
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmando(true)} disabled={trabalhando} className="h-10 px-4 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary">
              Aplicar aos {estado.semResponsavel} cards sem responsável
            </button>
          )}
        </>
      )}
      {aviso && (
        <span role={aviso.ok ? 'status' : 'alert'} className={`font-body-sm text-body-sm ${aviso.ok ? 'text-success-text' : 'text-danger-text'}`}>
          {aviso.texto}
        </span>
      )}
    </section>
  );
}

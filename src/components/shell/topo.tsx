'use client';

// T-146 (fase4-design-system-shell-acesso, US-098): topo da casca — quem
// está logado (AC-352), seletor de empresa só para super admin (AC-353,
// consome `POST /api/empresa-ativa` de T-144), indicador de tempo real
// (AC-354, `useTempoReal`), busca/sino "em breve" (AC-355, sem `onClick`) e
// "Sair" (AC-357: `POST /api/auth/sign-out` do Better Auth, T-144, depois
// `/login`). Fiel ao `<header>` do protótipo
// (`13._tarefas_fila_do_turno_atual/code.html`).
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { PapelUsuario } from '@/lib/auth/convites';

import { useTempoReal } from './use-tempo-real';

export interface EmpresaResumo {
  id: string;
  nome: string;
}

export interface UsuarioSessao {
  nome: string;
  email: string;
  papel: PapelUsuario;
  isSuperAdmin: boolean;
  empresaAtiva: EmpresaResumo;
  empresas?: EmpresaResumo[];
}

export interface TopoProps {
  usuario: UsuarioSessao;
  /** AC-356: abre a gaveta do menu no celular. */
  aoAbrirGaveta?: () => void;
}

async function trocarEmpresa(empresaId: string): Promise<void> {
  await fetch('/api/empresa-ativa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ empresaId }),
  });
  // AC-353: "a tela recarrega com os dados da nova empresa" — recarga real,
  // não só re-render (os dados do tenant anterior já podem estar em memória
  // em outros componentes da página).
  window.location.reload();
}

/**
 * AC-357: o sign-out do Better Auth exige `Content-Type: application/json` — sem ele
 * responde 415 e a sessão continua valendo (a tela de login então devolvia a pessoa ao
 * sistema, e o botão "Sair" parecia não fazer nada). Devolve `true` só se a sessão foi encerrada.
 */
async function sair(): Promise<boolean> {
  try {
    const resposta = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

export function Topo({ usuario, aoAbrirGaveta }: TopoProps) {
  const router = useRouter();
  const estadoTempoReal = useTempoReal();
  const [menuUsuarioAberto, setMenuUsuarioAberto] = useState(false);
  const [erroAoSair, setErroAoSair] = useState(false);

  async function aoClicarSair() {
    setErroAoSair(false);
    // Só vai ao login se a sessão foi mesmo encerrada: senão a tela de acesso o traria de volta.
    if (!(await sair())) {
      setErroAoSair(true);
      return;
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="h-16 bg-surface-card border-b border-border-subtle z-30 flex items-center justify-between px-gutter shadow-[0_1px_8px_rgba(0,0,0,0.02)]">
      <div className="flex items-center gap-space-lg flex-1 max-w-2xl">
        {/* AC-356: só existe no celular — abre a gaveta do menu lateral. */}
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={aoAbrirGaveta}
          className="md:hidden p-2 rounded-lg text-text-secondary hover:bg-surface-subtle"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">menu</span>
        </button>

        {/* AC-355: busca global visível, "em breve" — sem `onClick`, não abre nada. */}
        <div className="relative w-full max-w-lg">
          <span
            aria-hidden="true"
            className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[19px]"
          >
            search
          </span>
          <input
            className="w-full h-10 pl-9 pr-24 bg-surface-subtle border border-border-subtle rounded-lg font-body-md text-body-md text-text-primary placeholder:text-text-muted cursor-not-allowed"
            placeholder="Buscar lead, clínica, telefone ou responsável... (Ctrl + K)"
            type="text"
            readOnly
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-label-sm bg-surface-card border border-border-subtle text-text-muted rounded">
            Em breve
          </span>
        </div>

        {/* AC-353: só o super admin vê e usa o seletor de empresa. */}
        {usuario.isSuperAdmin && (
          <label className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-card text-text-primary shadow-sm cursor-pointer">
            <span aria-hidden="true" className="material-symbols-outlined text-primary text-[18px]">
              domain
            </span>
            <select
              aria-label="Empresa ativa"
              value={usuario.empresaAtiva.id}
              onChange={(evento) => trocarEmpresa(evento.target.value)}
              className="bg-transparent font-label-sm text-label-sm font-semibold focus:outline-none"
            >
              {(usuario.empresas ?? [usuario.empresaAtiva]).map((empresa) => (
                <option key={empresa.id} value={empresa.id}>
                  {empresa.nome}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center gap-space-md">
        {/* AC-354: estado real da conexão SSE — nunca otimista. */}
        {estadoTempoReal === 'conectado' ? (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-surface border border-success-border">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-text opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success-text" />
            </span>
            <span className="font-label-sm text-label-sm text-success-text font-semibold">Tempo real conectado</span>
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning-surface border border-warning-border">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-warning-text" />
            </span>
            <span className="font-label-sm text-label-sm text-warning-text font-semibold">Reconectando…</span>
          </div>
        )}

        {/* AC-355: sino de notificações "em breve" — sem `onClick`. */}
        <button
          type="button"
          aria-label="Notificações (em breve)"
          className="relative p-2 rounded-lg text-text-secondary cursor-not-allowed"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
            notifications
          </span>
          <span className="absolute -top-1 -right-1 font-label-sm text-[8px] px-1 rounded bg-surface-container text-text-muted uppercase">
            em breve
          </span>
        </button>

        <div className="h-6 w-px bg-border-subtle" />

        {/* AC-352/AC-357: menu do usuário — nome, papel, e-mail e empresa vindos da sessão; "Sair" abre aqui. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuUsuarioAberto((aberto) => !aberto)}
            className="flex items-center gap-space-sm pl-1 cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-on-primary text-[18px]">
                person
              </span>
            </div>
            <div className="hidden lg:flex flex-col text-left">
              <div className="flex items-center gap-1.5">
                <span className="font-label-lg text-label-lg font-semibold text-text-primary leading-tight">
                  {usuario.nome}
                </span>
                <span className="font-label-sm text-[10px] bg-primary-fixed text-on-primary-fixed px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                  {usuario.papel}
                </span>
              </div>
              <span className="font-label-sm text-label-sm text-text-muted leading-tight">{usuario.email}</span>
              <span className="font-label-sm text-label-sm text-text-muted leading-tight">
                {usuario.empresaAtiva.nome}
              </span>
            </div>
            <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[18px]">
              expand_more
            </span>
          </button>

          {menuUsuarioAberto && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-surface-card border border-border-subtle rounded-lg shadow-md py-1 z-20">
              <button
                type="button"
                onClick={aoClicarSair}
                className="w-full text-left px-3 py-2 font-label-md text-label-md text-danger-text hover:bg-danger-surface flex items-center gap-2"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  logout
                </span>
                Sair
              </button>
              {erroAoSair && (
                <p role="alert" className="px-3 py-2 font-body-sm text-body-sm text-danger-text">
                  Não foi possível sair. Tente de novo.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

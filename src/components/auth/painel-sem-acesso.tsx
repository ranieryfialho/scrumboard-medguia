'use client';

// T-152 (fase4-design-system-shell-acesso, US-103): painel de "sem acesso"
// (403) e de sessão expirada — fonte visual
// `5._sem_acesso_permiss_o_e_sess_o/code.html`, sem o selo de "sessão
// rastreada com criptografia de ponta a ponta" nem a versão fictícia
// "MedCRM v4.12" do protótipo (Q-042) e sem a simulação de despacho de
// pedido do botão "Solicitar permissão" — aqui ele fica com o selo "em
// breve", desabilitado, como os outros itens sem backend da casca
// (`src/components/shell/topo.tsx`, AC-355).
//
// Usa `useSearchParams` para ler o `de` de AC-375 (mesmo motivo de
// `formulario-login.tsx`, T-148: precisa do `<Suspense>` da página).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { nomeLegivelDaRota } from '@/lib/auth/nomes-de-rotas';

type EstadoSessao = 'verificando' | 'autenticado' | 'anonimo';

export function PainelSemAcesso() {
  const searchParams = useSearchParams();
  const rotaSolicitada = searchParams.get('de');
  const [estado, setEstado] = useState<EstadoSessao>('verificando');
  const [papel, setPapel] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    fetch('/api/me')
      .then(async (resposta) => {
        if (cancelado) return;
        if (!resposta.ok) {
          setEstado('anonimo');
          return;
        }
        const dados = await resposta.json();
        setPapel(typeof dados.papel === 'string' ? dados.papel : null);
        setEstado('autenticado');
      })
      .catch(() => {
        if (!cancelado) setEstado('anonimo');
      });

    return () => {
      cancelado = true;
    };
  }, []);

  if (estado === 'verificando') return null;

  // AC-377: sem sessão válida, a tela se apresenta como sessão expirada —
  // sem perfil, sem recurso, um único botão principal.
  if (estado === 'anonimo') {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 bg-danger-surface text-danger-text px-3.5 py-1 rounded-full font-label-md mb-4">
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            gpp_maybe
          </span>
          <span>Sessão Expirada</span>
        </div>
        <h1 className="font-headline-lg text-text-primary text-2xl md:text-3xl mb-3 tracking-tight">
          Sessão Expirada
        </h1>
        <p className="font-body-lg text-text-secondary max-w-xl mb-6">
          Sua sessão de trabalho expirou por inatividade, para garantir a segurança dos dados de
          pacientes e leads. Entre novamente para continuar.
        </p>
        <a
          href="/login"
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary hover:bg-primary-container text-on-primary font-label-lg py-3 px-5 rounded-lg shadow-md hover:shadow-lg transition-all duration-150"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            lock_reset
          </span>
          <span>Entrar novamente</span>
        </a>
      </div>
    );
  }

  // AC-375: perfil autenticado e recurso solicitado (nome legível, ou o
  // caminho tal como veio para uma rota que o sistema não conhece).
  const recursoLegivel = rotaSolicitada ? nomeLegivelDaRota(rotaSolicitada) : null;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="inline-flex items-center gap-2 bg-danger-surface text-danger-text px-3.5 py-1 rounded-full font-label-md mb-4">
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
          gpp_maybe
        </span>
        <span>Código 403</span>
      </div>
      <h1 className="font-headline-lg text-text-primary text-2xl md:text-3xl mb-3 tracking-tight">
        Acesso Restrito
      </h1>
      <p className="font-body-lg text-text-secondary max-w-xl mb-6">
        Você não tem permissão para acessar esta área, para garantir o isolamento dos dados entre
        papéis.
      </p>

      <div className="w-full max-w-lg bg-surface-subtle rounded-xl p-4 mb-8 text-left">
        <div className="space-y-1.5 font-body-sm text-text-secondary">
          <div className="flex items-start justify-between gap-4">
            <span className="text-text-muted shrink-0">Perfil Autenticado:</span>
            <span className="font-label-md text-text-primary bg-surface-container-high px-2 py-0.5 rounded">
              {papel}
            </span>
          </div>
          {recursoLegivel && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-text-muted shrink-0">Recurso Solicitado:</span>
              <span className="font-label-md text-danger-text bg-danger-surface px-2 py-0.5 rounded text-right truncate">
                {recursoLegivel}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* AC-376: cada botão leva aonde o rótulo diz. */}
      <div className="w-full max-w-md flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
        <a
          href="/login"
          className="w-full sm:w-1/2 flex items-center justify-center gap-2 bg-primary hover:bg-primary-container text-on-primary font-label-lg py-3 px-5 rounded-lg shadow-md hover:shadow-lg transition-all duration-150"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            lock_reset
          </span>
          <span>Entrar novamente</span>
        </a>
        <a
          href="/tarefas"
          className="w-full sm:w-1/2 flex items-center justify-center gap-2 bg-surface hover:bg-surface-subtle text-text-primary font-label-lg py-3 px-5 rounded-lg shadow-sm hover:shadow transition-all duration-150"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
            assignment_turned_in
          </span>
          <span>Minhas Tarefas</span>
        </a>
      </div>

      {/* AC-376: "Solicitar permissão ao Administrador" é um item sem backend
          (fora de escopo) — fica visível com o selo "em breve", desabilitado,
          sem navegar nem abrir nada. */}
      <div className="pt-2 flex items-center justify-center gap-2 text-text-secondary font-label-md">
        <span>Necessita deste nível de acesso?</span>
        <button
          type="button"
          disabled
          className="text-text-muted cursor-not-allowed font-headline-sm text-sm inline-flex items-center gap-1.5"
        >
          <span>Solicitar permissão ao Administrador</span>
          <span className="px-1.5 py-0.5 text-[10px] font-label-sm bg-surface-container text-text-muted uppercase rounded">
            em breve
          </span>
        </button>
      </div>
    </div>
  );
}

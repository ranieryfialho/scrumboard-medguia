'use client';

// T-148 (fase4-design-system-shell-acesso, US-099): formulário de login,
// fonte visual `1._login_acesso_plataforma/code.html` — sem o seletor de
// estado e sem "Lembrar de mim por 30 dias" (Q-044).
//
// AC-047 (fase1-auth-rbac) já bloqueia o login de verdade no servidor; esta
// tela não repete essa decisão — ela só precisa mostrar ao usuário quantas
// tentativas restam e por quanto tempo o acesso fica suspenso, mesmo que a
// aba seja reaberta dentro da janela (AC-360). Por isso guarda localmente,
// em `localStorage`, os horários das últimas respostas de credenciais
// inválidas, usando o mesmo limite/janela do servidor
// (`LIMITE_PADRAO_TENTATIVAS`/`JANELA_PADRAO_MS`, de `rate-limit.ts`) — é só
// a contagem exibida na tela, não uma segunda trava de segurança.
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { JANELA_PADRAO_MS, LIMITE_PADRAO_TENTATIVAS } from '@/lib/auth/rate-limit';

const CHAVE_TENTATIVAS = 'medcrm:login:tentativas-falhas';
const DURACAO_REALCE_MS = 2500;

function lerFalhasArmazenadas(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const bruto = window.localStorage.getItem(CHAVE_TENTATIVAS);
    if (!bruto) return [];
    const valores = JSON.parse(bruto);
    if (!Array.isArray(valores)) return [];
    return valores.filter((valor): valor is number => typeof valor === 'number');
  } catch {
    return [];
  }
}

function falhasNaJanela(agoraMs: number): number[] {
  const inicioJanela = agoraMs - JANELA_PADRAO_MS;
  return lerFalhasArmazenadas().filter((instante) => instante > inicioJanela);
}

function registrarFalhaLocal(agoraMs: number): number[] {
  const falhas = [...falhasNaJanela(agoraMs), agoraMs];
  window.localStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify(falhas));
  return falhas;
}

function limparFalhasLocais(): void {
  window.localStorage.removeItem(CHAVE_TENTATIVAS);
}

/** AC-358: `next` só aceita caminho do mesmo site — qualquer outra coisa cai no destino padrão. */
function destinoSeguro(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/pipeline';
  return next;
}

function formatarContagem(ms: number): string {
  const totalSegundos = Math.max(0, Math.ceil(ms / 1000));
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

export function FormularioLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [tentativasRestantes, setTentativasRestantes] = useState<number | null>(null);
  const [realce, setRealce] = useState(false);
  // AC-360 (reabrir a tela dentro do bloqueio): o estado inicial já conta
  // com as falhas guardadas de uma visita anterior, sem esperar uma nova
  // tentativa — `lerFalhasArmazenadas` devolve `[]` no servidor (SSR).
  const [bloqueadoAteMs, setBloqueadoAteMs] = useState<number | null>(() => {
    const falhas = falhasNaJanela(Date.now());
    return falhas.length >= LIMITE_PADRAO_TENTATIVAS ? Math.min(...falhas) + JANELA_PADRAO_MS : null;
  });
  const [restanteMs, setRestanteMs] = useState(0);
  const realceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (bloqueadoAteMs === null) return;

    const atualizar = () => {
      const restante = bloqueadoAteMs - Date.now();
      if (restante <= 0) {
        limparFalhasLocais();
        setBloqueadoAteMs(null);
        setRestanteMs(0);
        return;
      }
      setRestanteMs(restante);
    };

    atualizar();
    const id = setInterval(atualizar, 1000);
    return () => clearInterval(id);
  }, [bloqueadoAteMs]);

  useEffect(() => {
    return () => {
      if (realceTimeoutRef.current) clearTimeout(realceTimeoutRef.current);
    };
  }, []);

  const bloqueado = bloqueadoAteMs !== null;

  async function handleSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    // AC-361: um envio em andamento (ou a tela bloqueada) ignora novos cliques.
    if (enviando || bloqueado) return;

    setEnviando(true);
    setTentativasRestantes(null);
    setRealce(false);

    let resposta: Response;
    try {
      resposta = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: senha }),
      });
    } catch {
      setEnviando(false);
      return;
    }

    if (resposta.ok) {
      limparFalhasLocais();
      router.push(destinoSeguro(searchParams.get('next')));
      return;
    }

    // AC-359: a mesma mensagem vale para credenciais erradas, e-mail
    // inexistente e usuário inativo — o servidor já responde igual nos três
    // casos, então a tela não precisa (nem pode) diferenciá-los.
    const falhas = registrarFalhaLocal(Date.now());
    setEnviando(false);

    if (falhas.length >= LIMITE_PADRAO_TENTATIVAS) {
      setBloqueadoAteMs(Math.min(...falhas) + JANELA_PADRAO_MS);
    } else {
      setTentativasRestantes(LIMITE_PADRAO_TENTATIVAS - falhas.length);
      setRealce(true);
      if (realceTimeoutRef.current) clearTimeout(realceTimeoutRef.current);
      realceTimeoutRef.current = setTimeout(() => setRealce(false), DURACAO_REALCE_MS);
    }
  }

  const classeRealce = realce ? 'ring-2 ring-danger-text/50' : '';

  return (
    <>
      <div className="flex flex-col items-center text-center mb-8">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-primary to-primary-container text-on-primary shadow-md shadow-primary/20 mb-4">
          <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            local_hospital
          </span>
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          <span className="font-headline-lg text-headline-lg tracking-tight text-text-primary font-bold">
            MedCRM
          </span>
          <span className="bg-info-surface text-info-text text-label-sm font-label-sm px-2 py-0.5 rounded-full font-medium">
            B2B
          </span>
        </div>
        <p className="font-body-md text-text-secondary text-body-md mt-1.5">
          CRM B2B para Clínicas e Consultórios
        </p>
      </div>

      <div className="mb-5 space-y-3">
        {!bloqueado && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-subtle text-text-secondary">
            <span className="material-symbols-outlined text-primary text-xl flex-shrink-0 mt-0.5">shield</span>
            <div className="text-left">
              <p className="font-label-md text-label-md font-semibold text-text-primary">Proteção de Acesso</p>
              <p className="font-body-sm text-body-sm text-text-secondary mt-0.5 leading-snug">
                Por motivos de segurança, a conta será bloqueada temporariamente após{' '}
                {LIMITE_PADRAO_TENTATIVAS} tentativas incorretas em {JANELA_PADRAO_MS / 60000} minutos.
              </p>
            </div>
          </div>
        )}

        {!bloqueado && tentativasRestantes !== null && (
          <div role="alert" className="flex items-start gap-3 p-3.5 rounded-xl bg-danger-surface text-danger-text">
            <span
              className="material-symbols-outlined text-danger-text text-xl flex-shrink-0 mt-0.5"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              error
            </span>
            <div className="text-left">
              <p className="font-label-md text-label-md font-semibold text-danger-text">Credenciais Inválidas</p>
              <p className="font-body-sm text-body-sm text-danger-text/90 mt-0.5">
                E-mail ou senha incorretos. Restam{' '}
                <span className="font-semibold underline">
                  {tentativasRestantes} tentativa{tentativasRestantes === 1 ? '' : 's'}
                </span>{' '}
                antes da retenção provisória da conta.
              </p>
            </div>
          </div>
        )}

        {bloqueado && (
          <div role="alert" className="flex items-start gap-3 p-3.5 rounded-xl bg-warning-surface text-warning-text">
            <span
              className="material-symbols-outlined text-warning-text text-xl flex-shrink-0 mt-0.5"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              lock_clock
            </span>
            <div className="text-left">
              <p className="font-label-md text-label-md font-semibold text-warning-text">
                Acesso Temporariamente Suspenso
              </p>
              <p className="font-body-sm text-body-sm text-warning-text/90 mt-0.5">
                Limite de {LIMITE_PADRAO_TENTATIVAS} tentativas excedido. Acesso bloqueado por segurança por{' '}
                <span className="font-semibold">{formatarContagem(restanteMs)}</span> minutos.
              </p>
            </div>
          </div>
        )}
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-1.5 text-left">
          <label htmlFor="email" className="block font-label-md text-label-md text-text-primary font-medium">
            E-mail institucional
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <span className="material-symbols-outlined text-xl">alternate_email</span>
            </div>
            <input
              id="email"
              name="email"
              type="email"
              required
              disabled={bloqueado}
              placeholder="nome@medguia.com.br"
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              className={`w-full h-11 pl-10 pr-3.5 rounded-lg bg-surface-card text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-white ${classeRealce}`}
            />
          </div>
        </div>

        <div className="space-y-1.5 text-left">
          <label htmlFor="password" className="block font-label-md text-label-md text-text-primary font-medium">
            Senha de acesso
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <span className="material-symbols-outlined text-xl">key</span>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              disabled={bloqueado}
              placeholder="••••••••••••"
              value={senha}
              onChange={(evento) => setSenha(evento.target.value)}
              className={`w-full h-11 pl-10 pr-3.5 rounded-lg bg-surface-card text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-white ${classeRealce}`}
            />
          </div>
        </div>

        <div className="flex items-center justify-end pt-1">
          <a
            className="font-label-md text-label-md text-primary hover:text-on-primary-fixed-variant transition-colors hover:underline"
            href="/esqueci-senha"
          >
            Esqueci minha senha
          </a>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={enviando || bloqueado}
            className="w-full h-12 rounded-lg font-headline-sm text-headline-sm text-on-primary bg-primary hover:bg-primary-container active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-md shadow-primary/25 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {bloqueado ? (
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">lock</span>
                Acesso Bloqueado Temporariamente
              </span>
            ) : enviando ? (
              <span
                role="status"
                aria-label="Enviando"
                className="material-symbols-outlined text-xl animate-spin"
              >
                progress_activity
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Entrar na Plataforma
                <span className="material-symbols-outlined text-lg">arrow_forward</span>
              </span>
            )}
          </button>
        </div>
      </form>
    </>
  );
}

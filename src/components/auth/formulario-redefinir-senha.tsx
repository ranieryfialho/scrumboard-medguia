'use client';

// T-150 (fase4-design-system-shell-acesso, US-101): formulário de
// redefinição de senha, fonte visual
// `3._redefinir_senha_token_nova_senha/code.html` — sem a barra de força de
// senha do protótipo (métrica própria, fora da política de T-141) e sem o
// seletor de estado de erro do link.
//
// AC-370 (link expirado, inexistente ou já usado) é decidido pelo servidor
// (`GET /api/acesso/redefinir-senha/[token]`, T-145) sem consumir o token;
// esta tela só lê esse resultado para trocar o cartão pelo painel de erro,
// sem nunca mostrar o formulário de senha para um token inválido.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CriteriosSenha } from '@/components/auth/criterios-senha';
import { senhaAtendePolitica } from '@/lib/auth/politica-senha';

const MENSAGEM_SENHAS_DIFERENTES = 'As senhas informadas não coincidem.';

type EstadoToken = 'verificando' | 'valido' | 'invalido';

export interface FormularioRedefinirSenhaProps {
  token: string;
}

export function FormularioRedefinirSenha({ token }: FormularioRedefinirSenhaProps) {
  const router = useRouter();
  const [estadoToken, setEstadoToken] = useState<EstadoToken>('verificando');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let cancelado = false;

    fetch(`/api/acesso/redefinir-senha/${token}`)
      .then((resposta) => {
        if (cancelado) return;
        setEstadoToken(resposta.ok ? 'valido' : 'invalido');
      })
      .catch(() => {
        if (!cancelado) setEstadoToken('invalido');
      });

    return () => {
      cancelado = true;
    };
  }, [token]);

  // AC-367: a lista de critérios (`CriteriosSenha`) já acende e apaga cada
  // item a partir da mesma `avaliarSenha`; aqui só decidimos se todos estão
  // atendidos, para destravar o botão.
  const senhaValida = senhaAtendePolitica(senha);
  // AC-368: só mostra o erro de confirmação depois que o usuário digitou
  // alguma coisa no segundo campo — e só libera o envio com as duas
  // senhas iguais e a política inteira atendida.
  const senhasCoincidem = confirmacao.length > 0 && senha === confirmacao;
  const mostrarErroConfirmacao = confirmacao.length > 0 && !senhasCoincidem;
  const podeSalvar = senhaValida && senhasCoincidem;

  async function handleSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando || !podeSalvar) return;

    setEnviando(true);

    let resposta: Response;
    try {
      resposta = await fetch(`/api/acesso/redefinir-senha/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ senha }),
      });
    } catch {
      setEnviando(false);
      return;
    }

    if (!resposta.ok) {
      setEnviando(false);
      // Token consumido ou expirado entre a abertura da tela e o envio.
      setEstadoToken('invalido');
      return;
    }

    // AC-369/ASM-126: a sessão nova já foi criada pelo servidor.
    router.push('/pipeline');
  }

  if (estadoToken === 'verificando') {
    return <div aria-hidden="true" />;
  }

  if (estadoToken === 'invalido') {
    return (
      <div className="space-y-5 text-center">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-danger-surface text-danger-text mx-auto shadow-sm">
          <span className="material-symbols-outlined text-[28px]">timer_off</span>
        </div>
        <div className="space-y-1.5">
          <h1 className="font-headline-lg text-headline-lg text-text-primary">Link expirado ou inválido</h1>
          <p className="font-body-md text-body-md text-text-secondary leading-relaxed">
            O link de redefinição expirou ou já foi utilizado. Solicite um novo link para continuar.
          </p>
        </div>
        <div className="space-y-3 pt-2">
          <a
            href="/esqueci-senha"
            className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg rounded-lg shadow-md shadow-primary/25 transition-all duration-150 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">outgoing_mail</span>
            <span>Solicitar novo link</span>
          </a>
          <a
            href="/login"
            className="w-full h-11 bg-surface-subtle hover:bg-surface-container text-text-primary font-label-lg text-label-lg rounded-lg transition-all duration-150 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            <span>Voltar ao login</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-info-surface text-primary mb-6 shadow-inner mx-auto">
        <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          lock_reset
        </span>
      </div>
      <div className="text-center mb-7">
        <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Criar nova senha</h1>
        <p className="font-body-md text-body-md text-text-secondary leading-relaxed">
          Defina uma senha forte para acessar sua conta MedCRM.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-1.5 text-left">
          <label htmlFor="password" className="block font-label-md text-label-md text-text-primary font-medium">
            Nova senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Insira a nova senha"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
            className="w-full h-11 px-3.5 rounded-lg bg-surface-subtle text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-card"
          />
        </div>

        <div className="space-y-1.5 text-left">
          <label
            htmlFor="password-confirm"
            className="block font-label-md text-label-md text-text-primary font-medium"
          >
            Confirmação da nova senha
          </label>
          <input
            id="password-confirm"
            name="password-confirm"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Repita sua nova senha"
            value={confirmacao}
            onChange={(evento) => setConfirmacao(evento.target.value)}
            className="w-full h-11 px-3.5 rounded-lg bg-surface-subtle text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-card"
          />
          {mostrarErroConfirmacao && (
            <p role="alert" className="flex items-center gap-1 pt-1 font-label-sm text-label-sm text-danger-text">
              <span className="material-symbols-outlined text-[14px]">cancel</span>
              {MENSAGEM_SENHAS_DIFERENTES}
            </p>
          )}
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-lg space-y-2 text-left">
          <p className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
            Critérios de Segurança
          </p>
          <CriteriosSenha senha={senha} />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={enviando || !podeSalvar}
            className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg rounded-lg shadow-md shadow-primary/25 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {enviando ? (
              <span
                role="status"
                aria-label="Salvando"
                className="material-symbols-outlined text-[18px] animate-spin"
              >
                progress_activity
              </span>
            ) : (
              <>
                <span>Salvar nova senha e entrar</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </>
            )}
          </button>
        </div>
      </form>
    </>
  );
}

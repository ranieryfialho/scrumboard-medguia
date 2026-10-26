'use client';

// T-149 (fase4-design-system-shell-acesso, US-100): formulário de "esqueci
// minha senha", fonte visual
// `2._esqueci_senha_recuperar_senha/code.html` — o prazo exibido é 24 horas
// (não os 30 minutos do protótipo), decidido no spec (AC-364).
//
// AC-364/AC-365 (a mesma confirmação para qualquer e-mail, e o envio real)
// já são do servidor (`POST /api/acesso/esqueci-senha`, T-145); esta tela só
// recusa texto que não é e-mail antes de chamar o servidor (AC-363) e deixa
// voltar ao formulário vazio a partir da confirmação (AC-366).
import { useState } from 'react';

const MENSAGEM_EMAIL_INVALIDO = 'Por favor, insira um e-mail válido.';
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FormularioEsqueciSenha() {
  const [email, setEmail] = useState('');
  const [erroEmail, setErroEmail] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [emailEnviado, setEmailEnviado] = useState('');

  async function handleSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;

    const emailDigitado = email.trim();
    // AC-363: texto que não é e-mail é recusado aqui — nada é enviado ao servidor.
    if (!REGEX_EMAIL.test(emailDigitado)) {
      setErroEmail(true);
      return;
    }
    setErroEmail(false);
    setEnviando(true);

    let resposta: Response;
    try {
      resposta = await fetch('/api/acesso/esqueci-senha', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailDigitado }),
      });
    } catch {
      setEnviando(false);
      return;
    }

    setEnviando(false);
    if (!resposta.ok) return;

    setEmailEnviado(emailDigitado);
    setEnviado(true);
  }

  // AC-366: volta o formulário vazio.
  function tentarOutroEmail() {
    setEmail('');
    setErroEmail(false);
    setEnviado(false);
  }

  if (enviado) {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-success-surface text-success-text mb-5 shadow-sm">
          <span className="material-symbols-outlined text-[30px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            mark_email_read
          </span>
        </div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Instruções enviadas!</h1>
        <p className="font-body-md text-body-md text-text-secondary leading-relaxed mb-4">
          Se <span className="font-semibold text-text-primary">{emailEnviado}</span> estiver cadastrado no MedGuia,
          enviamos as instruções de redefinição para a caixa de entrada. O link expira em 24 horas por motivos de
          segurança.
        </p>
        <div className="w-full space-y-3">
          <button
            type="button"
            onClick={tentarOutroEmail}
            className="w-full h-11 bg-surface-subtle hover:bg-surface-container text-text-primary font-label-lg text-label-lg rounded-lg transition-all duration-150 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">replay</span>
            <span>Tentar outro e-mail</span>
          </button>
          <a
            href="/login"
            className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg rounded-lg shadow-md shadow-primary/25 transition-all duration-150 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">login</span>
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
        <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Recuperação de Senha</h1>
        <p className="font-body-md text-body-md text-text-secondary leading-relaxed">
          Informe o e-mail cadastrado na sua clínica para enviarmos um link seguro de redefinição.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-1.5 text-left">
          <label htmlFor="email" className="block font-label-md text-label-md text-text-primary font-medium">
            E-mail cadastrado
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <span className="material-symbols-outlined text-xl">mail</span>
            </div>
            <input
              id="email"
              name="email"
              type="text"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="contato@clinicamedica.com.br"
              value={email}
              onChange={(evento) => {
                setEmail(evento.target.value);
                if (erroEmail) setErroEmail(false);
              }}
              className="w-full h-11 pl-10 pr-3.5 rounded-lg bg-surface-subtle text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-card"
            />
          </div>
          {erroEmail && (
            <p role="alert" className="flex items-center gap-1 pt-1 font-label-sm text-label-sm text-danger-text">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {MENSAGEM_EMAIL_INVALIDO}
            </p>
          )}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={enviando}
            className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg rounded-lg shadow-md shadow-primary/25 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {enviando ? (
              <span role="status" aria-label="Enviando" className="material-symbols-outlined text-[18px] animate-spin">
                progress_activity
              </span>
            ) : (
              <>
                <span>Enviar link de recuperação</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </>
            )}
          </button>
        </div>
      </form>

      <div className="mt-8 pt-6 text-center">
        <a
          href="/login"
          className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary font-label-lg text-label-lg transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Voltar para a tela de login</span>
        </a>
      </div>
    </>
  );
}

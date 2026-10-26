'use client';

// T-151 (fase4-design-system-shell-acesso, US-102): formulário de ativação
// do convite, fonte visual `4._convite_token_aceitar_convite/code.html` —
// sem o bloco "Contatos do Administrador" do estado de erro (ASM-128) e sem
// o seletor de estado do protótipo. Os links de Termos de Uso e de Suporte
// ficam com o selo "em breve" (fora de escopo, sem `href`), no mesmo molde
// das pendências do topo (`src/components/shell/topo.tsx`, AC-355).
//
// AC-371/AC-374 (para quem é o convite, ou erro genérico sem vazar dados) já
// são decididos pelo servidor (`GET /api/acesso/convite/[token]`, T-145);
// esta tela só lê esse resultado. AC-373 (ativar cria a senha, grava o nome
// e entra) também é do servidor — aqui só chamamos a API e seguimos para
// `/pipeline` quando ela confirma.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { CriteriosSenha } from '@/components/auth/criterios-senha';
import { senhaAtendePolitica } from '@/lib/auth/politica-senha';

const DESCRICAO_PAPEL: Record<string, string> = {
  ATENDENTE: 'Pipeline, Tarefas e Conversas',
  GERENTE: 'Pipeline, Tarefas, Conversas e Indicadores',
  MASTER: 'Acesso completo à empresa',
};

interface ConviteValido {
  email: string;
  papel: string;
  empresa: { id: string; nome: string };
}

type EstadoToken = 'verificando' | 'valido' | 'invalido';

export interface FormularioConviteProps {
  token: string;
}

export function FormularioConvite({ token }: FormularioConviteProps) {
  const router = useRouter();
  const [estadoToken, setEstadoToken] = useState<EstadoToken>('verificando');
  const [convite, setConvite] = useState<ConviteValido | null>(null);
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [aceiteTermos, setAceiteTermos] = useState(false);
  const [enviando, setEnviando] = useState(false);

  function verificarConvite() {
    setEstadoToken('verificando');

    fetch(`/api/acesso/convite/${token}`)
      .then(async (resposta) => {
        if (!resposta.ok) {
          setConvite(null);
          setEstadoToken('invalido');
          return;
        }
        const dados = await resposta.json();
        setConvite({ email: dados.email, papel: dados.papel, empresa: dados.empresa });
        setEstadoToken('valido');
      })
      .catch(() => {
        setConvite(null);
        setEstadoToken('invalido');
      });
  }

  useEffect(() => {
    verificarConvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // AC-372: o botão só libera com nome, senha dentro da política (AC-386,
  // mesmo módulo do servidor), confirmação igual e aceite dos termos.
  const senhaValida = senhaAtendePolitica(senha);
  const senhasCoincidem = confirmacao.length > 0 && senha === confirmacao;
  const mostrarErroConfirmacao = confirmacao.length > 0 && !senhasCoincidem;
  const podeAtivar = nome.trim().length > 0 && senhaValida && senhasCoincidem && aceiteTermos;

  async function handleSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando || !podeAtivar) return;

    setEnviando(true);

    let resposta: Response;
    try {
      resposta = await fetch(`/api/acesso/convite/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), senha }),
      });
    } catch {
      setEnviando(false);
      return;
    }

    if (!resposta.ok) {
      setEnviando(false);
      // Convite consumido ou expirado entre a abertura da tela e o envio.
      setConvite(null);
      setEstadoToken('invalido');
      return;
    }

    // AC-373/ASM-126: a sessão nova já foi criada pelo servidor.
    router.push('/pipeline');
  }

  if (estadoToken === 'verificando') {
    return <div aria-hidden="true" />;
  }

  if (estadoToken === 'invalido' || !convite) {
    return (
      <div className="space-y-5 text-center">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-danger-surface text-danger-text mx-auto shadow-sm">
          <span className="material-symbols-outlined text-[28px]">link_off</span>
        </div>
        <div className="space-y-1.5">
          <h1 className="font-headline-lg text-headline-lg text-text-primary">Convite expirado ou já utilizado</h1>
          <p className="font-body-md text-body-md text-text-secondary leading-relaxed">
            Este convite não é mais válido. Fale com o administrador da sua clínica para emitir um novo acesso.
          </p>
        </div>
        <div className="space-y-3 pt-2">
          <a
            href="/login"
            className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg rounded-lg shadow-md shadow-primary/25 transition-all duration-150 flex items-center justify-center gap-2"
          >
            <span>Ir para login</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </a>
          <button
            type="button"
            onClick={verificarConvite}
            className="w-full h-11 bg-surface-subtle hover:bg-surface-container text-text-primary font-label-lg text-label-lg rounded-lg transition-all duration-150 flex items-center justify-center gap-2"
          >
            <span>Voltar para validação</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-5 -m-8 mb-6 md:-m-10 md:mb-6 bg-surface-subtle rounded-t-2xl">
        <div className="flex items-start justify-between gap-4 p-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-info-surface text-info-text flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-2xl">apartment</span>
            </div>
            <div>
              <p className="font-label-sm text-label-sm uppercase tracking-wider text-text-secondary">
                Você foi convidado para a empresa
              </p>
              <h2 className="font-headline-md text-headline-md text-text-primary">{convite.empresa.nome}</h2>
            </div>
          </div>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-success-surface text-success-text text-label-sm font-label-sm shrink-0">
            Convite Ativo
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">
          <div className="p-3 bg-surface-card rounded-xl shadow-sm flex flex-col justify-between">
            <span className="font-label-sm text-label-sm text-text-muted">Seu papel de acesso</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-base">badge</span>
              <span className="font-label-lg text-label-lg text-text-primary">{convite.papel}</span>
            </div>
            <span className="font-body-sm text-body-sm text-text-secondary mt-0.5">
              {DESCRICAO_PAPEL[convite.papel] ?? 'Acesso conforme o papel atribuído'}
            </span>
          </div>

          <div className="p-3 bg-surface-card rounded-xl shadow-sm flex flex-col justify-between">
            <span className="font-label-sm text-label-sm text-text-muted">E-mail corporativo</span>
            <div className="mt-1 flex items-center gap-1.5 truncate">
              <span className="material-symbols-outlined text-success-text text-base">mail</span>
              <label htmlFor="email-convite" className="sr-only">
                E-mail corporativo
              </label>
              <input
                id="email-convite"
                readOnly
                value={convite.email}
                className="font-label-lg text-label-lg text-text-primary truncate bg-transparent border-none p-0 focus:outline-none w-full"
              />
            </div>
            <span className="font-body-sm text-body-sm text-text-muted mt-0.5">Verificado e vinculado</span>
          </div>
        </div>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-1.5 text-left">
          <label htmlFor="nome" className="block font-label-md text-label-md text-text-primary font-medium">
            Nome completo
          </label>
          <input
            id="nome"
            name="nome"
            type="text"
            autoComplete="name"
            required
            placeholder="Digite seu nome completo"
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            className="w-full h-11 px-3.5 rounded-lg bg-surface-subtle text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-card"
          />
        </div>

        <div className="space-y-1.5 text-left">
          <label htmlFor="password" className="block font-label-md text-label-md text-text-primary font-medium">
            Definir senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Mínimo 8 dígitos"
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
            Confirmar senha
          </label>
          <input
            id="password-confirm"
            name="password-confirm"
            type="password"
            autoComplete="new-password"
            required
            placeholder="Repita a senha"
            value={confirmacao}
            onChange={(evento) => setConfirmacao(evento.target.value)}
            className="w-full h-11 px-3.5 rounded-lg bg-surface-subtle text-text-primary placeholder-text-muted font-body-md text-body-md shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-card"
          />
          {mostrarErroConfirmacao && (
            <p role="alert" className="flex items-center gap-1 pt-1 font-label-sm text-label-sm text-danger-text">
              <span className="material-symbols-outlined text-[14px]">cancel</span>
              As senhas informadas não coincidem.
            </p>
          )}
        </div>

        <div className="bg-surface-subtle p-3.5 rounded-lg space-y-2 text-left">
          <p className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
            Critérios de Segurança
          </p>
          <CriteriosSenha senha={senha} />
        </div>

        <div className="p-3.5 bg-surface-subtle rounded-xl flex items-start gap-3">
          <input
            id="aceite-termos"
            name="aceite-termos"
            type="checkbox"
            checked={aceiteTermos}
            onChange={(evento) => setAceiteTermos(evento.target.checked)}
            className="mt-0.5 w-4 h-4 text-primary bg-surface-card rounded focus:ring-primary focus:ring-2 cursor-pointer shrink-0"
          />
          <label
            htmlFor="aceite-termos"
            className="font-body-sm text-body-sm text-text-secondary cursor-pointer leading-relaxed select-none"
          >
            Li e concordo com os{' '}
            <span className="text-text-muted">
              Termos de Uso
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-label-sm bg-surface-card border border-border-subtle text-text-muted rounded">
                Em breve
              </span>
            </span>{' '}
            e autorizo o tratamento de dados cadastrais conforme a{' '}
            <strong className="text-text-primary">LGPD (Lei Geral de Proteção de Dados - Lei 13.709/18)</strong> para
            finalidade de rotinas hospitalares e gestão médica.
          </label>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={enviando || !podeAtivar}
            className="w-full h-11 bg-primary hover:bg-primary-container text-on-primary font-label-lg text-label-lg rounded-lg shadow-md shadow-primary/25 transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {enviando ? (
              <span
                role="status"
                aria-label="Ativando"
                className="material-symbols-outlined text-[18px] animate-spin"
              >
                progress_activity
              </span>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
                <span>Ativar minha conta</span>
              </>
            )}
          </button>
        </div>

        <p className="text-center font-body-sm text-body-sm text-text-muted">
          Precisa de ajuda?{' '}
          <span className="text-text-muted">
            Suporte
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-label-sm bg-surface-card border border-border-subtle text-text-muted rounded">
              Em breve
            </span>
          </span>
        </p>
      </form>
    </>
  );
}

'use client';

// T-214 (fase4-admin, US-138): tela "Convidar Novo Usuário para a Equipe" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/27._equipe_convidar_convidar_usu_rio/`. Convida por
// `POST /api/equipe/convites`. A matriz de acessos de cada papel vem das regras de acesso do
// sistema (`src/lib/auth/rotas.ts`): ATENDENTE não vê análises, equipe nem empresas, etc.
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { COR_DO_PAPEL, PAPEIS, iniciais, mensagemDeErro, type Papel, type UsuarioLogado } from './comum';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DESCRICAO: Record<Papel, { titulo: string; texto: string }> = {
  ATENDENTE: { titulo: 'Operação Comercial', texto: 'Pipeline, cadência de 18 toques, tarefas do turno, agenda e conversas de WhatsApp dos seus próprios leads.' },
  GERENTE: { titulo: 'Gestão e Liderança', texto: 'Tudo do atendente, mais campanhas, indicadores, relatórios, equipe (convida atendentes) e motivos de perda.' },
  MASTER: { titulo: 'Administrador Geral', texto: 'Acesso a todas as áreas da empresa, inclusive trocar papéis, desativar pessoas e convidar qualquer papel.' },
};

const PERMITIDO: Record<Papel, string[]> = {
  ATENDENTE: ['Funil, lista e cards dos seus leads', 'Tarefas do turno, atrasadas e cadência de 18 toques', 'Agenda de reuniões', 'WhatsApp: conversas e envio'],
  GERENTE: ['Tudo do atendente, em toda a equipe', 'Campanhas de e-mail', 'Indicadores e relatórios', 'Convidar atendentes e reenviar convites', 'Motivos de perda (consulta)'],
  MASTER: ['Tudo do gerente', 'Convidar qualquer papel', 'Trocar papel e desativar colaboradores', 'Conexão e configuração do WhatsApp'],
};

const BLOQUEADO: Record<Papel, string[]> = {
  ATENDENTE: ['Indicadores e relatórios (/indicadores, /relatorios)', 'Campanhas', 'Equipe e convites', 'Empresas da rede'],
  GERENTE: ['Trocar papel ou desativar colaboradores', 'Convidar gerente ou master', 'Empresas da rede'],
  MASTER: ['Empresas da rede (só o super admin)'],
};

interface Criado {
  email: string;
  emailEnviado: boolean;
  linkConvite: string | null;
  reativado: boolean;
}

export function ConvidarUsuario() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Papel | ''>('');
  const [eu, setEu] = useState<UsuarioLogado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u: UsuarioLogado | null) => !cancelado && setEu(u))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  // ASM-202: o gerente só convida atendente.
  const souGerente = eu?.papel === 'GERENTE' && !eu?.isSuperAdmin;
  const papeisDisponiveis = souGerente ? (['ATENDENTE'] as Papel[]) : PAPEIS.slice().reverse();
  const emailOk = EMAIL.test(email.trim());
  const podeEnviar = nome.trim() !== '' && emailOk && papel !== '' && !enviando;

  async function enviar() {
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    setCriado(null);
    try {
      const r = await fetch('/api/equipe/convites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim(), papel }),
      });
      const corpo = (await r.json().catch(() => null)) as { codigo?: string; mensagem?: string; emailEnviado?: boolean; linkConvite?: string | null; reativado?: boolean } | null;
      if (!r.ok) {
        setErro(corpo?.mensagem ?? mensagemDeErro(corpo?.codigo));
        return;
      }
      setCriado({ email: email.trim().toLowerCase(), emailEnviado: corpo?.emailEnviado === true, linkConvite: corpo?.linkConvite ?? null, reativado: corpo?.reativado === true });
    } catch {
      setErro('Não foi possível enviar o convite. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    if (!criado?.linkConvite) return;
    try {
      await navigator.clipboard.writeText(criado.linkConvite);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  const CLASSE_CAMPO = 'h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary w-full focus:outline-none';

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <Link href="/equipe" className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-semibold hover:underline mb-1">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
            Voltar para Gestão da Equipe
          </Link>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Convidar Novo Usuário para a Equipe</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">O convite vale por 24 horas e só pode ser usado uma vez. A pessoa cria a própria senha ao aceitar.</p>
        </div>
        <div className="flex items-center gap-space-sm">
          <Link href="/equipe" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center">
            Cancelar
          </Link>
          <button type="button" onClick={() => void enviar()} disabled={!podeEnviar} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50">
            Enviar Convite por E-mail
          </button>
        </div>
      </div>

      {erro && (
        <p role="alert" className="font-body-md text-body-md text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          {erro}
        </p>
      )}
      {criado && (
        <section role="status" className="font-body-md text-body-md text-success-text bg-success-surface rounded-lg px-3 py-3 flex flex-col gap-2">
          <p>{criado.reativado ? `Acesso reativado para ${criado.email}.` : `Convite criado para ${criado.email}`}</p>
          {criado.linkConvite && (
            <div className="flex items-center gap-2 flex-wrap">
              <code className="px-2 py-1 rounded bg-surface-card text-text-primary break-all">{criado.linkConvite}</code>
              <button type="button" onClick={() => void copiar()} className="h-8 px-3 rounded-lg bg-surface-card font-label-md text-label-md font-semibold text-text-primary">
                {copiado ? 'Copiado' : 'Copiar link'}
              </button>
            </div>
          )}
          {criado.linkConvite && !criado.emailEnviado && <p className="text-warning-text">O e-mail não pôde ser enviado: copie o link e envie manualmente.</p>}
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md items-start">
        <div className="flex flex-col gap-space-md">
          <section aria-label="Dados Cadastrais do Colaborador" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">1. Dados Cadastrais do Colaborador</h2>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Nome completo *
              <input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome completo" className={CLASSE_CAMPO} />
            </label>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              E-mail corporativo *
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail corporativo" className={CLASSE_CAMPO} />
              {email !== '' && !emailOk && <span className="text-danger-text">Informe um e-mail válido.</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              <ItemEmBreve rotulo="WhatsApp Corporativo" icone="call" className="h-9 px-3 rounded-lg bg-surface-subtle" />
              <ItemEmBreve rotulo="Departamento / Squad" icone="groups" className="h-9 px-3 rounded-lg bg-surface-subtle" />
            </div>
          </section>

          <section aria-label="Definição de Papel e Permissões" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">2. Definição de Papel e Permissões</h2>
            <div role="radiogroup" aria-label="Papel" className="flex flex-col gap-2">
              {papeisDisponiveis.map((p) => (
                <label key={p} className={`rounded-xl p-3 flex flex-col gap-1 cursor-pointer ${papel === p ? 'bg-info-surface' : 'bg-surface-subtle'}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-label-lg text-label-lg text-text-primary">
                      <input type="radio" name="papel" value={p} checked={papel === p} onChange={() => setPapel(p)} aria-label={p} />
                      {p}
                    </span>
                    <span className="font-label-sm text-label-sm text-text-muted">{DESCRICAO[p].titulo}</span>
                  </span>
                  <span className="font-body-sm text-body-sm text-text-secondary">{DESCRICAO[p].texto}</span>
                </label>
              ))}
            </div>
            {souGerente && <p className="font-body-sm text-body-sm text-text-muted">Como gerente, você só convida atendentes.</p>}
          </section>

          <section aria-label="Parâmetros de Acesso" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">3. Parâmetros de Acesso e Automação</h2>
            <p className="font-body-md text-body-md text-text-secondary">Validade do convite: <strong>24 horas</strong>.</p>
            <div className="flex flex-wrap gap-2">
              <ItemEmBreve rotulo="Exigir 2FA no primeiro acesso" icone="verified_user" className="h-9 px-3 rounded-lg bg-surface-subtle" />
              <ItemEmBreve rotulo="Atribuir leads automaticamente" icone="shuffle" className="h-9 px-3 rounded-lg bg-surface-subtle" />
              <ItemEmBreve rotulo="Validade do token" icone="timer" className="h-9 px-3 rounded-lg bg-surface-subtle" />
              <ItemEmBreve rotulo="Mensagem personalizada de boas-vindas" icone="chat" className="h-9 px-3 rounded-lg bg-surface-subtle" />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-space-md">
          <section aria-label="Prévia do card de usuário" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
            <span className="font-label-sm text-label-sm text-text-muted uppercase tracking-wider">Prévia do card de usuário</span>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="w-12 h-12 rounded-xl bg-primary text-on-primary flex items-center justify-center font-headline-sm text-headline-sm">{nome.trim() ? iniciais(nome) : '?'}</span>
              <div className="flex flex-col min-w-0">
                <span className="font-label-lg text-label-lg text-text-primary truncate">{nome.trim() || 'Nome do colaborador'}</span>
                <span className="font-body-sm text-body-sm text-text-muted truncate">{email.trim() || 'e-mail@empresa.com'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {papel !== '' && <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DO_PAPEL[papel]}`}>{papel}</span>}
              <span className="px-2.5 py-1 rounded-full bg-warning-surface text-warning-text font-label-sm text-label-sm">Pendente</span>
            </div>
          </section>

          {papel !== '' && (
            <section aria-label="Matriz de Acessos" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Matriz de Acessos: {papel}</h2>
              <span className="font-label-sm text-label-sm text-success-text uppercase">Acessos permitidos</span>
              <ul className="flex flex-col gap-1">
                {PERMITIDO[papel].map((t) => (
                  <li key={t} className="rounded-lg bg-success-surface text-success-text px-3 py-1.5 font-body-sm text-body-sm">
                    {t}
                  </li>
                ))}
              </ul>
              <span className="font-label-sm text-label-sm text-danger-text uppercase">Acessos bloqueados</span>
              <ul className="flex flex-col gap-1">
                {BLOQUEADO[papel].map((t) => (
                  <li key={t} className="rounded-lg bg-danger-surface text-danger-text px-3 py-1.5 font-body-sm text-body-sm line-through">
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

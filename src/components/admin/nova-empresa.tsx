'use client';

// T-217 (fase4-admin, US-141): tela "Cadastrar Nova Empresa ou Filial" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/30._admin_empresas_nova_criar_empresa/`. Só o super
// admin. Cria por `POST /api/admin/empresas` (empresa + convite do master). O CRM só guarda nome
// e identificador: razão social, CNPJ, endereço, plano e assentos não existem (Q-059).
import { useState } from 'react';
import Link from 'next/link';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { mensagemDeErro, sugerirSlug } from './comum';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Criada {
  id: string;
  slug: string;
  emailEnviado: boolean;
  linkConvite: string;
}

export function NovaEmpresa() {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEditado, setSlugEditado] = useState(false);
  const [masterNome, setMasterNome] = useState('');
  const [masterEmail, setMasterEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<Partial<Record<'nome' | 'slug' | 'masterNome' | 'masterEmail' | 'geral', string>>>({});
  const [criada, setCriada] = useState<Criada | null>(null);
  const [copiado, setCopiado] = useState(false);

  function mudarNome(valor: string) {
    setNome(valor);
    if (!slugEditado) setSlug(sugerirSlug(valor));
  }

  const completo = nome.trim().length >= 3 && slug.length >= 3 && masterNome.trim() !== '' && EMAIL.test(masterEmail.trim());

  async function criar() {
    if (!completo || enviando) return;
    setEnviando(true);
    setErros({});
    try {
      const r = await fetch('/api/admin/empresas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), slug, masterNome: masterNome.trim(), masterEmail: masterEmail.trim() }),
      });
      const corpo = (await r.json().catch(() => null)) as (Criada & { codigo?: string; campo?: string; mensagem?: string }) | null;
      if (r.ok && corpo) {
        setCriada({ id: corpo.id, slug: corpo.slug, emailEnviado: corpo.emailEnviado, linkConvite: corpo.linkConvite });
        return;
      }
      if (corpo?.codigo === 'SLUG_EM_USO') setErros({ slug: 'Esse identificador já está em uso.' });
      else if (corpo?.campo) setErros({ [corpo.campo]: corpo.mensagem ?? 'Valor inválido.' });
      else setErros({ geral: mensagemDeErro(corpo?.codigo) });
    } catch {
      setErros({ geral: 'Não foi possível criar a empresa. Tente de novo.' });
    } finally {
      setEnviando(false);
    }
  }

  async function copiar() {
    if (!criada) return;
    try {
      await navigator.clipboard.writeText(criada.linkConvite);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  const CLASSE_CAMPO = 'h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary w-full focus:outline-none';
  const Erro = ({ campo }: { campo: keyof typeof erros }) => (erros[campo] ? <span className="text-danger-text">{erros[campo]}</span> : null);

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <Link href="/admin/empresas" className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-semibold hover:underline mb-1">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
            Voltar para Gestão de Empresas
          </Link>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Cadastrar Nova Empresa ou Filial</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">A empresa nasce ativa e o administrador master recebe um convite de 24 horas para criar a senha.</p>
        </div>
        <div className="flex items-center gap-space-sm">
          <Link href="/admin/empresas" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center">
            Cancelar
          </Link>
          <button type="button" onClick={() => void criar()} disabled={!completo || enviando || criada !== null} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50">
            Criar e Provisionar Empresa
          </button>
        </div>
      </div>

      {erros.geral && (
        <p role="alert" className="font-body-md text-body-md text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          {erros.geral}
        </p>
      )}
      {criada && (
        <section role="status" className="font-body-md text-body-md text-success-text bg-success-surface rounded-lg px-3 py-3 flex flex-col gap-2">
          <p>Empresa criada.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="px-2 py-1 rounded bg-surface-card text-text-primary break-all">{criada.linkConvite}</code>
            <button type="button" onClick={() => void copiar()} className="h-8 px-3 rounded-lg bg-surface-card font-label-md text-label-md font-semibold text-text-primary">
              {copiado ? 'Copiado' : 'Copiar link'}
            </button>
          </div>
          {!criada.emailEnviado && <p className="text-warning-text">O e-mail não pôde ser enviado: copie o link e envie manualmente.</p>}
          <Link href={`/admin/empresas/${criada.id}`} className="font-label-md text-label-md font-semibold underline">
            Abrir a empresa
          </Link>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md items-start">
        <div className="flex flex-col gap-space-md">
          <section aria-label="Identificação Cadastral" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">1. Identificação Cadastral da Clínica</h2>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Nome da empresa *
              <input value={nome} onChange={(e) => mudarNome(e.target.value)} aria-label="Nome da empresa" className={CLASSE_CAMPO} />
              <Erro campo="nome" />
            </label>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Identificador do tenant (slug) *
              <input
                value={slug}
                onChange={(e) => {
                  setSlugEditado(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                aria-label="Identificador do tenant"
                className={`${CLASSE_CAMPO} font-mono`}
              />
              <span className="text-text-muted">De 3 a 40 letras minúsculas, números e hífens. Não muda depois de criado.</span>
              <Erro campo="slug" />
            </label>
          </section>

          <section aria-label="Administrador Master Inicial" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">2. Administrador Master Inicial</h2>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Nome completo do gestor master *
              <input value={masterNome} onChange={(e) => setMasterNome(e.target.value)} aria-label="Nome do gestor master" className={CLASSE_CAMPO} />
              <Erro campo="masterNome" />
            </label>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              E-mail corporativo do master *
              <input type="email" value={masterEmail} onChange={(e) => setMasterEmail(e.target.value)} aria-label="E-mail do master" className={CLASSE_CAMPO} />
              <Erro campo="masterEmail" />
            </label>
          </section>
        </div>

        <div className="flex flex-col gap-space-md">
          <section aria-label="Resumo do Provisionamento" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Resumo do Provisionamento</h2>
            <p className="font-body-sm text-body-sm text-text-muted">Endereço do tenant</p>
            <p className="font-mono text-body-md text-primary break-all">app/{slug || 'identificador'}</p>
            <p className="font-body-sm text-body-sm text-text-muted">Administrador master</p>
            <p className="font-body-md text-body-md text-text-primary">{masterNome.trim() || '—'}</p>
            <p className="font-body-sm text-body-sm text-text-muted break-all">{masterEmail.trim() || '—'}</p>
          </section>
          <section aria-label="Plano de Assinatura & Cotas" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Plano de Assinatura &amp; Cotas</h2>
            <ItemEmBreve rotulo="Plano e cotas de recursos" icone="workspace_premium" className="h-9 px-3 rounded-lg bg-surface-subtle" />
          </section>
        </div>
      </div>
    </div>
  );
}

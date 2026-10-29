'use client';

// T-217 (fase4-admin, US-142): tela de edição da empresa — fonte visual
// `docs/ui/stitch_medcrm_interface_design/31._admin_empresas_id_editar_empresa/`. Só o super
// admin. Detalhe de `GET /api/admin/empresas/[id]`; salva o nome e suspende/reativa por `PATCH`.
// O identificador não muda. Razão social, CNPJ, endereço, plano e assentos (fase5-empresa-dados)
// são editáveis; integrações e logs não existem no sistema.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CamposDeEndereco, CamposDeIdentificacao, CamposDePlano, corpoDosDados, valoresDaEmpresa, type ErrosDaEmpresa, type ValoresDaEmpresa } from './campos-da-empresa';
import { COR_DA_SITUACAO, COR_DO_PAPEL, ROTULO_DA_SITUACAO, formatarData, iniciais, mensagemDeErro, trocarEmpresaAtiva, type ColaboradorView, type EmpresaView } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';

interface Detalhe {
  empresa: EmpresaView;
  assentosEmUso?: number;
  colaboradores: ColaboradorView[];
  resumo: { total: number; ativos: number; pendentes: number; inativos: number };
}

export function EditarEmpresa({ id }: { id: string }) {
  const [dados, setDados] = useState<Detalhe | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro' | 'nao-encontrada'>('carregando');
  const [nome, setNome] = useState('');
  const [valores, setValores] = useState<ValoresDaEmpresa | null>(null);
  const [erros, setErros] = useState<ErrosDaEmpresa>({});
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/empresas/${id}`);
      if (r.status === 404) return setEstado('nao-encontrada');
      if (!r.ok) throw new Error(`empresa respondeu ${r.status}`);
      const d = (await r.json()) as Detalhe;
      setDados(d);
      setNome((atual) => atual || d.empresa.nome);
      setValores(valoresDaEmpresa(d.empresa as never));
      setEstado('ok');
    } catch {
      setEstado('erro');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(corpo: Record<string, unknown>, sucesso: string) {
    setTrabalhando(true);
    setAviso(null);
    setErros({});
    try {
      const r = await fetch(`/api/admin/empresas/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      if (!r.ok) {
        const e = (await r.json().catch(() => null)) as { codigo?: string; campo?: string; mensagem?: string } | null;
        if (e?.campo) setErros({ [e.campo]: e.mensagem ?? 'Valor inválido.' });
        else if (e?.codigo === 'CNPJ_EM_USO') setErros({ cnpj: mensagemDeErro(e.codigo) });
        else if (e?.codigo === 'ASSENTOS_ABAIXO_DO_EM_USO') setErros({ assentos: mensagemDeErro(e.codigo) });
        setAviso({ ok: false, texto: e?.mensagem ?? mensagemDeErro(e?.codigo) });
        return;
      }
      setAviso({ ok: true, texto: sucesso });
      await carregar();
    } catch {
      setAviso({ ok: false, texto: mensagemDeErro(undefined) });
    } finally {
      setTrabalhando(false);
      setConfirmando(false);
    }
  }

  async function acessar() {
    const r = await trocarEmpresaAtiva(id);
    if (r.ok) window.location.reload();
    else setAviso({ ok: false, texto: r.mensagem });
  }

  if (estado === 'carregando') return <div className="p-space-md"><EsqueletoCarregando /></div>;
  if (estado === 'erro') return <div className="p-space-md"><EstadoErro mensagem="Não foi possível carregar a empresa. Tente de novo." onTentarDeNovo={carregar} /></div>;
  if (estado === 'nao-encontrada' || !dados) {
    return (
      <div className="p-space-md">
        <EstadoVazio titulo="Empresa não encontrada" proximoPasso="volte para a rede de empresas" icone="search_off" />
        <Link href="/admin/empresas" className="font-label-md text-label-md text-primary font-semibold hover:underline">Voltar para Rede de Empresas</Link>
      </div>
    );
  }

  const { empresa, colaboradores, resumo } = dados;
  const original = valoresDaEmpresa(empresa as never);
  const mudou = nome.trim() !== empresa.nome || (valores !== null && JSON.stringify(valores) !== JSON.stringify(original));

  return (
    <div className="p-space-md space-y-space-md">
      <Link href="/admin/empresas" className="inline-flex items-center gap-1 font-label-md text-label-md text-primary font-semibold hover:underline">
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
        Voltar para Rede de Empresas
      </Link>

      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-start justify-between flex-wrap gap-space-md">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">{empresa.nome}</h1>
            <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${empresa.ativo ? 'bg-success-surface text-success-text' : 'bg-surface-container text-text-muted'}`}>{empresa.ativo ? 'Ativa' : 'Inativa'}</span>
          </div>
          <p className="font-body-sm text-body-sm text-text-muted font-mono">tenant: {empresa.slug}</p>
          <p className="font-body-sm text-body-sm text-text-muted">Criada em {formatarData(empresa.criadoEm)}</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button type="button" onClick={() => void acessar()} className="h-10 px-4 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
            Acessar esta empresa
          </button>
          <ItemEmBreve rotulo="Impersonate / Acessar como Master" icone="bolt" className="h-10 px-4 rounded-xl bg-surface-subtle" />
          <button type="button" onClick={() => void salvar({ nome: nome.trim(), ...(valores ? corpoDosDados(valores) : {}) }, 'Alterações salvas.')} disabled={!mudou || nome.trim().length < 3 || trabalhando} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50">
            Salvar Alterações
          </button>
        </div>
      </section>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <ItemEmBreve rotulo="Integrações & WhatsApp Evolution" className="h-9 px-3 rounded-lg bg-surface-subtle" />
        <ItemEmBreve rotulo="Logs de Auditoria" className="h-9 px-3 rounded-lg bg-surface-subtle" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
        <CartaoIndicador titulo="Usuários ativos" valor={String(resumo.ativos)} legenda={`de ${resumo.total} cadastrados`} icone="groups" cor="success" />
        <CartaoIndicador titulo="Convites pendentes" valor={String(resumo.pendentes)} legenda="aguardando a senha" icone="mark_email_unread" cor="warning" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md items-start">
        <section aria-label="Dados Cadastrais da Empresa" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Dados Cadastrais da Empresa</h2>
          <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
            Nome da empresa
            <input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome da empresa" className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary w-full focus:outline-none" />
          </label>
          <div className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
            Identificador do tenant
            <p className="h-10 px-3 rounded-xl bg-surface-subtle flex items-center font-mono text-body-md text-text-primary">{empresa.slug}</p>
            <span className="text-text-muted">Inalterável após a criação.</span>
          </div>
          {valores && (
            <>
              <CamposDeIdentificacao valores={valores} onMudar={setValores} erros={erros} />
              <h3 className="font-label-lg text-label-lg text-text-primary">Endereço</h3>
              <CamposDeEndereco valores={valores} onMudar={setValores} erros={erros} />
              <h3 className="font-label-lg text-label-lg text-text-primary">Plano e cota</h3>
              <CamposDePlano valores={valores} onMudar={setValores} erros={erros} emUso={dados.assentosEmUso ?? resumo.ativos + resumo.pendentes} />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <ItemEmBreve rotulo="Políticas de governança e dados" icone="policy" className="h-9 px-3 rounded-lg bg-surface-subtle" />
          </div>
        </section>

        <section aria-label="Usuários da Empresa" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Usuários do Tenant</h2>
            <span className="font-body-sm text-body-sm text-text-muted">{resumo.total} cadastrados</span>
          </div>
          {colaboradores.length === 0 && <p className="font-body-md text-body-md text-text-secondary">Nenhuma pessoa nesta empresa</p>}
          <ul className="flex flex-col gap-2">
            {colaboradores.map((c) => (
              <li key={c.usuarioId} className="rounded-xl bg-surface-subtle p-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center font-label-md text-label-md text-text-secondary">{iniciais(c.nome)}</span>
                  <span className="flex flex-col min-w-0">
                    <span className="font-label-lg text-label-lg text-text-primary truncate">{c.nome}</span>
                    <span className="font-body-sm text-body-sm text-text-muted truncate">{c.email}</span>
                  </span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm ${COR_DO_PAPEL[c.papel]}`}>{c.papel}</span>
                  <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm ${COR_DA_SITUACAO[c.status]}`}>{ROTULO_DA_SITUACAO[c.status]}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-label="Zona de Perigo" className="bg-danger-surface rounded-2xl p-space-md flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm text-danger-text">Zona de Perigo (Super Admin)</h2>
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-surface-card p-3">
          <div>
            <p className="font-label-lg text-label-lg text-text-primary">{empresa.ativo ? 'Suspender acesso temporariamente' : 'Reativar a empresa'}</p>
            <p className="font-body-sm text-body-sm text-text-muted">
              {empresa.ativo ? 'Bloqueia o login de todos os usuários da empresa, sem apagar dados.' : 'Devolve o acesso aos usuários da empresa.'}
            </p>
          </div>
          <button type="button" onClick={() => setConfirmando(true)} className="h-10 px-4 rounded-xl bg-danger-text text-on-primary font-label-md text-label-md font-semibold">
            {empresa.ativo ? 'Suspender' : 'Reativar'}
          </button>
        </div>
        <ItemEmBreve rotulo="Desativar e Arquivar Tenant" icone="archive" className="self-start h-9 px-3 rounded-lg bg-surface-card" />
      </section>

      {confirmando && (
        <Dialog open onOpenChange={(aberto) => !aberto && setConfirmando(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{empresa.ativo ? 'Suspender empresa' : 'Reativar empresa'}</DialogTitle>
              <DialogDescription>
                {empresa.ativo
                  ? `${empresa.nome} fica sem acesso: os ${resumo.total} usuários não conseguem entrar até a empresa ser reativada. Nenhum dado é apagado.`
                  : `${empresa.nome} volta a funcionar e os usuários voltam a entrar.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
              <Button disabled={trabalhando} onClick={() => void salvar({ ativo: !empresa.ativo }, empresa.ativo ? 'Empresa suspensa.' : 'Empresa reativada.')}>
                {empresa.ativo ? 'Suspender' : 'Reativar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

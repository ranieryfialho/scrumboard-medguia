'use client';

// T-216 (fase4-admin, US-140): tela "Rede de Organizações & Franquias" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/29._admin_empresas_empresas/`. Só o super admin.
// Lista de `GET /api/admin/empresas`; "Acessar" troca a empresa ativa pela rota que já
// existe (`POST /api/empresa-ativa`). CNPJ, plano, licenças e pipeline da rede não existem.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { formatarData, iniciais, trocarEmpresaAtiva, type EmpresaView } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';

interface EmpresaDaLista extends EmpresaView {
  usuariosAtivos: number;
  usuariosTotal: number;
}
interface Resposta {
  empresas: EmpresaDaLista[];
  resumo: { total: number; ativas: number; inativas: number; usuariosAtivos: number };
}

export function Empresas() {
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [atualId, setAtualId] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [trocando, setTrocando] = useState(false);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (busca.trim()) q.set('busca', busca.trim());
    try {
      const r = await fetch(`/api/admin/empresas?${q}`);
      if (!r.ok) throw new Error(`empresas respondeu ${r.status}`);
      setDados((await r.json()) as Resposta);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [status, busca]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u: { empresaAtiva?: { id: string } } | null) => {
        if (cancelado || !u?.empresaAtiva) return;
        setAtualId(u.empresaAtiva.id);
        setEscolhida((atual) => atual || u.empresaAtiva!.id);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  async function acessar(id: string) {
    setTrocando(true);
    setAviso(null);
    const r = await trocarEmpresaAtiva(id);
    setTrocando(false);
    if (r.ok) {
      setAtualId(id);
      window.location.reload();
    } else {
      setAviso(r.mensagem);
    }
  }

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Rede de Organizações &amp; Franquias</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">As empresas da rede MedCRM, com a situação de cada uma e a quantidade de pessoas.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <ItemEmBreve rotulo="Exportar Base (CSV)" icone="download" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
          <Link href="/admin/empresas/nova" className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">add_business</span>
            Nova Empresa / Clínica
          </Link>
        </div>
      </div>

      {aviso && (
        <p role="alert" className="font-body-md text-body-md text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          {aviso}
        </p>
      )}
      {erro && <EstadoErro mensagem="Não foi possível carregar as empresas. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}
      {dados && (
        <>
          <section aria-label="Trocar de Empresa Ativa" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-label-lg text-label-lg text-text-primary">Trocar de Empresa Ativa</h2>
              <p className="font-body-sm text-body-sm text-text-muted">Escolha a empresa para alternar o painel operacional com seus privilégios de super admin.</p>
            </div>
            <div className="flex items-center gap-2">
              <select aria-label="Empresa ativa" value={escolhida} onChange={(e) => setEscolhida(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md">
                {dados.empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                    {e.id === atualId ? ' (Atual)' : ''}
                  </option>
                ))}
              </select>
              <button type="button" disabled={trocando || !escolhida || escolhida === atualId} onClick={() => void acessar(escolhida)} className="h-10 px-4 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50">
                Acessar
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
            <CartaoIndicador titulo="Empresas na rede" valor={String(dados.resumo.total)} legenda={`${dados.resumo.ativas} ativas · ${dados.resumo.inativas} inativas`} icone="apartment" />
            <CartaoIndicador titulo="Usuários ativos" valor={String(dados.resumo.usuariosAtivos)} legenda="em todas as empresas" icone="groups" cor="success" />
          </div>

          <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-2 flex-wrap">
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar por nome ou identificador" placeholder="Buscar clínica ou identificador..." className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md min-w-64 focus:outline-none" />
            <select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-subtle">
              <option value="">Todos os Status</option>
              <option value="ativa">Ativa</option>
              <option value="inativa">Inativa</option>
            </select>
            <ItemEmBreve rotulo="Todos os Planos" icone="filter_list" className="h-10 px-3 rounded-xl bg-surface-subtle" />
            <button type="button" onClick={() => { setStatus(''); setBusca(''); }} className="h-10 px-3 rounded-xl text-text-muted hover:text-text-primary">
              Limpar
            </button>
          </section>

          {dados.empresas.length === 0 ? (
            <section className="bg-surface-card rounded-2xl shadow-sm">
              <EstadoVazio titulo="Nenhuma empresa encontrada" proximoPasso="ajuste os filtros ou cadastre uma em Nova Empresa / Clínica" icone="apartment" />
            </section>
          ) : (
            <section aria-label="Organizações Cadastradas" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
              <div className="p-space-md flex items-center gap-2">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Organizações Cadastradas</h2>
                <span className="font-body-sm text-body-sm text-text-muted">{dados.empresas.length} exibidas</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Organização / Clínica</th>
                      <th className="px-space-md py-3">Status</th>
                      <th className="px-space-md py-3">Usuários</th>
                      <th className="px-space-md py-3">Criada em</th>
                      <th className="px-space-md py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.empresas.map((e) => (
                      <tr key={e.id} className="border-t border-surface-container">
                        <td className="px-space-md py-3">
                          <div className="flex items-center gap-3">
                            <span aria-hidden="true" className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center font-label-lg text-label-lg">{iniciais(e.nome)}</span>
                            <div className="flex flex-col min-w-0">
                              <span className="flex items-center gap-2">
                                <Link href={`/admin/empresas/${e.id}`} className="font-label-lg text-label-lg text-text-primary hover:text-primary">{e.nome}</Link>
                                {e.id === atualId && <span className="px-2 py-0.5 rounded-full bg-info-surface text-primary font-label-sm text-label-sm">Atual</span>}
                              </span>
                              <span className="font-body-sm text-body-sm text-text-muted font-mono">tenant: {e.slug}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-space-md py-3">
                          <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${e.ativo ? 'bg-success-surface text-success-text' : 'bg-surface-container text-text-muted'}`}>{e.ativo ? 'Ativa' : 'Inativa'}</span>
                        </td>
                        <td className="px-space-md py-3 font-body-md text-body-md">{e.usuariosAtivos} ativos / {e.usuariosTotal}</td>
                        <td className="px-space-md py-3 font-body-sm text-body-sm text-text-muted">{formatarData(e.criadoEm)}</td>
                        <td className="px-space-md py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/admin/empresas/${e.id}`} aria-label={`Abrir ${e.nome}`} className="h-8 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center">
                              Abrir
                            </Link>
                            <button type="button" aria-label={`Acessar ${e.nome}`} disabled={trocando || e.id === atualId} onClick={() => void acessar(e.id)} className="h-8 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50">
                              Acessar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

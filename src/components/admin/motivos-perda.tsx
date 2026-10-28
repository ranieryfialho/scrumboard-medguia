'use client';

// T-215 (fase4-admin, US-139): tela "Motivos de Perda & Churn Comercial" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/28._configuracoes_motivos_perda_motivos_de_perda/`.
// O catálogo é global (ASM-201): MASTER e GERENTE consultam; só o super admin cria e
// (des)ativa motivo personalizado. O motivo só tem nome e situação, então categoria,
// descrição e "Top 1" do protótipo não existem.
import { useCallback, useEffect, useState } from 'react';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { mensagemDeErro, type UsuarioLogado } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';

const POR_PAGINA = 10;

interface Motivo {
  id: string;
  nome: string;
  sistemico: boolean;
  ativo: boolean;
  usadoNoMes: number;
  usadoTotal: number;
  podeEditar: boolean;
}
interface Resposta {
  motivos: Motivo[];
  totais: { total: number; ativos: number; sistemicos: number; personalizados: number };
  resumo: { perdasNoMes: number; principal: { nome: string; quantidade: number; percentual: number } | null };
}

export function MotivosPerda() {
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [eu, setEu] = useState<UsuarioLogado | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (status) q.set('status', status);
    if (busca.trim()) q.set('busca', busca.trim());
    try {
      const r = await fetch(`/api/configuracoes/motivos-perda?${q}`);
      if (!r.ok) throw new Error(`motivos respondeu ${r.status}`);
      setDados((await r.json()) as Resposta);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [tipo, status, busca]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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

  async function criar() {
    setTrabalhando(true);
    setErroDoNome(null);
    try {
      const r = await fetch('/api/configuracoes/motivos-perda', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome: nome.trim() }) });
      if (r.ok) {
        setCriando(false);
        setNome('');
        setAviso({ ok: true, texto: 'Motivo criado.' });
        await carregar();
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { codigo?: string; mensagem?: string } | null;
      setErroDoNome(corpo?.mensagem ?? mensagemDeErro(corpo?.codigo));
    } catch {
      setErroDoNome(mensagemDeErro(undefined));
    } finally {
      setTrabalhando(false);
    }
  }

  async function alternar(m: Motivo) {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/configuracoes/motivos-perda/${m.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ativo: !m.ativo }) });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
        setAviso({ ok: false, texto: mensagemDeErro(corpo?.codigo) });
        return;
      }
      setAviso({ ok: true, texto: m.ativo ? `"${m.nome}" foi desativado.` : `"${m.nome}" foi ativado.` });
      await carregar();
    } catch {
      setAviso({ ok: false, texto: mensagemDeErro(undefined) });
    } finally {
      setTrabalhando(false);
    }
  }

  const superAdmin = eu?.isSuperAdmin === true;
  const visiveis = dados?.motivos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA) ?? [];

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Motivos de Perda &amp; Churn Comercial</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">Os motivos que o time escolhe ao mandar um card para &quot;Perdido&quot;, e quanto cada um pesa na sua empresa.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <ItemEmBreve rotulo="Exportar Relatório de Churn (CSV)" icone="download" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
          {superAdmin && (
            <button type="button" onClick={() => { setErroDoNome(null); setCriando(true); }} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md">
              + Novo Motivo de Perda
            </button>
          )}
        </div>
      </div>

      <section aria-label="Requisito bloqueante" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <p className="font-body-md text-body-md text-text-secondary max-w-3xl">
          <strong className="text-text-primary">Requisito bloqueante:</strong> nenhum card passa para &quot;Perdido&quot; sem um motivo escolhido deste catálogo.
        </p>
        <ItemEmBreve rotulo="Ver Diretrizes" icone="info" />
      </section>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
        </p>
      )}

      {erro && <EstadoErro mensagem="Não foi possível carregar os motivos. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}
      {dados && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
            <CartaoIndicador titulo="Catálogo de motivos" valor={`${dados.totais.ativos} ativos`} legenda={`${dados.totais.sistemicos} sistêmicos · ${dados.totais.personalizados} personalizados`} icone="rule" />
            <CartaoIndicador titulo="Perdas no mês" valor={String(dados.resumo.perdasNoMes)} legenda="cards que foram para Perdido" icone="trending_down" cor="danger" />
            <CartaoIndicador
              titulo="Principal motivo"
              valor={dados.resumo.principal?.nome ?? '—'}
              legenda={dados.resumo.principal ? `${dados.resumo.principal.percentual.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% do mês` : 'Sem perdas no mês'}
              icone="priority_high"
              cor="warning"
            />
          </div>

          <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-2 flex-wrap">
            <input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(1);
              }}
              aria-label="Buscar por nome do motivo"
              placeholder="Buscar por nome do motivo..."
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md min-w-64 focus:outline-none"
            />
            <div role="group" aria-label="Tipo" className="flex items-center gap-1 rounded-xl bg-surface-subtle p-1">
              {[
                ['', 'Todos os Tipos'],
                ['sistemico', 'Sistêmicos'],
                ['personalizado', 'Personalizados'],
              ].map(([valor, rotulo]) => (
                <button key={valor} type="button" aria-pressed={tipo === valor} onClick={() => { setTipo(valor); setPagina(1); }} className={`h-8 px-3 rounded-lg font-label-md text-label-md ${tipo === valor ? 'bg-surface-card text-primary font-semibold shadow-sm' : 'text-text-secondary'}`}>
                  {rotulo}
                </button>
              ))}
            </div>
            <select aria-label="Situação" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} className="h-10 px-3 rounded-xl bg-surface-subtle">
              <option value="">Status: Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
            <button type="button" onClick={() => { setTipo(''); setStatus(''); setBusca(''); setPagina(1); }} className="h-10 px-3 rounded-xl text-text-muted hover:text-text-primary">
              Limpar
            </button>
          </section>

          {dados.motivos.length === 0 ? (
            <section className="bg-surface-card rounded-2xl shadow-sm">
              <EstadoVazio titulo="Nenhum motivo encontrado" proximoPasso="ajuste os filtros" icone="rule" />
            </section>
          ) : (
            <section aria-label="Motivos" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Motivo</th>
                      <th className="px-space-md py-3">Natureza</th>
                      <th className="px-space-md py-3">Cards perdidos (mês / total)</th>
                      <th className="px-space-md py-3">Status</th>
                      <th className="px-space-md py-3 text-right">Ações de gestão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((m) => (
                      <tr key={m.id} className={`border-t border-surface-container ${m.ativo ? '' : 'opacity-70'}`}>
                        <td className={`px-space-md py-3 font-label-lg text-label-lg text-text-primary ${m.ativo ? '' : 'line-through'}`}>{m.nome}</td>
                        <td className="px-space-md py-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm ${m.sistemico ? 'bg-info-surface text-info-text' : 'bg-surface-container text-text-secondary'}`}>
                            {m.sistemico && <span aria-hidden="true" className="material-symbols-outlined text-[14px]">lock</span>}
                            {m.sistemico ? 'Sistêmico' : 'Personalizado'}
                          </span>
                        </td>
                        <td className="px-space-md py-3 font-body-md text-body-md">
                          {m.usadoNoMes} no mês
                          <p className="font-body-sm text-[11px] text-text-muted">Histórico: {m.usadoTotal} cards</p>
                        </td>
                        <td className="px-space-md py-3">
                          <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${m.ativo ? 'bg-success-surface text-success-text' : 'bg-surface-container text-text-muted'}`}>{m.ativo ? 'Ativo' : 'Inativo'}</span>
                        </td>
                        <td className="px-space-md py-3">
                          <div className="flex items-center justify-end gap-2">
                            <ItemEmBreve rotulo="Ver detalhes" />
                            {m.podeEditar && (
                              <button type="button" disabled={trabalhando} onClick={() => void alternar(m)} aria-label={`${m.ativo ? 'Desativar' : 'Ativar'}: ${m.nome}`} className="h-8 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50">
                                {m.ativo ? 'Desativar' : 'Ativar'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={dados.motivos.length} onMudarPagina={setPagina} rotuloItem="motivos" />
            </section>
          )}

          <ItemEmBreve rotulo="Abrir Playbook de Objeções Médicas" icone="menu_book" />
        </>
      )}

      {criando && (
        <Dialog open onOpenChange={(aberto) => !aberto && setCriando(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo motivo de perda</DialogTitle>
              <DialogDescription>O motivo passa a valer para todas as empresas e começa ativo.</DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Nome do motivo
              <input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome do motivo" className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary" />
            </label>
            {erroDoNome && (
              <p role="alert" className="text-sm text-danger-text">
                {erroDoNome}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCriando(false)}>
                Cancelar
              </Button>
              <Button disabled={trabalhando || nome.trim().length < 3} onClick={() => void criar()}>
                Criar motivo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

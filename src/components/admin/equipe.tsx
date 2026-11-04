'use client';

// T-213 (fase4-admin, US-137): tela "Gestão da Equipe e Acessos" — fonte visual
// `docs/ui/stitch_medcrm_interface_design/26._equipe_equipe_e_controle_de_acessos/`.
// Lista, troca papel, desativa/reativa e reenvia convite pela API nova (`/api/equipe`);
// trocar papel e desativar são só do MASTER e do super admin (ASM-202).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  COR_DA_SITUACAO,
  COR_DO_PAPEL,
  PAPEIS,
  ROTULO_DA_SITUACAO,
  iniciais,
  mensagemDeErro,
  podeGerir,
  ultimoAcessoTexto,
  type ColaboradorView,
  type Papel,
  type Situacao,
  type UsuarioLogado,
} from './comum';
import { DialogoDeAcessos, DialogoDeAuditoria, DialogoDePoliticas, DialogoDeSessao, ROTULO_DA_ACAO, dataEHora, detalheDoEvento, type EventoDeAuditoria } from './equipe-dialogos';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';

const POR_PAGINA = 10;

interface Resposta {
  colaboradores: ColaboradorView[];
  total: number;
  resumo: { total: number; ativos: number; pendentes: number; inativos: number };
  assentos?: { emUso: number; limite: number | null };
}

export function Equipe() {
  const [papel, setPapel] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [eu, setEu] = useState<UsuarioLogado | null>(null);
  const [aConfirmar, setAConfirmar] = useState<ColaboradorView | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [painel, setPainel] = useState<'politicas' | 'auditoria' | 'sessao' | null>(null);
  const [exportando, setExportando] = useState(false);
  const [editandoAcessos, setEditandoAcessos] = useState<ColaboradorView | null>(null);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams({ pagina: String(pagina), porPagina: String(POR_PAGINA) });
    if (papel) q.set('papel', papel);
    if (status) q.set('status', status);
    if (busca.trim()) q.set('busca', busca.trim());
    try {
      const r = await fetch(`/api/equipe?${q}`);
      if (!r.ok) throw new Error(`equipe respondeu ${r.status}`);
      setDados((await r.json()) as Resposta);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [pagina, papel, status, busca]);

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

  async function alterar(c: ColaboradorView, corpo: { papel?: Papel; ativo?: boolean }) {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/equipe/${c.usuarioId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      if (!r.ok) {
        const e = (await r.json().catch(() => null)) as { codigo?: string } | null;
        setAviso({ ok: false, texto: mensagemDeErro(e?.codigo) });
        return;
      }
      setAviso({ ok: true, texto: corpo.papel ? `Papel de ${c.nome} atualizado.` : corpo.ativo ? `${c.nome} foi reativado.` : `${c.nome} foi desativado.` });
      await carregar();
    } catch {
      setAviso({ ok: false, texto: mensagemDeErro(undefined) });
    } finally {
      setTrabalhando(false);
      setAConfirmar(null);
    }
  }

  async function reenviar(c: ColaboradorView) {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/equipe/${c.usuarioId}/reenviar-convite`, { method: 'POST' });
      const corpo = (await r.json().catch(() => null)) as { codigo?: string; emailEnviado?: boolean; linkConvite?: string } | null;
      if (!r.ok) {
        setAviso({ ok: false, texto: mensagemDeErro(corpo?.codigo) });
        return;
      }
      setAviso({
        ok: true,
        texto: corpo?.emailEnviado
          ? `Convite reenviado para ${c.email}.`
          : `Convite renovado, mas o e-mail não pôde ser enviado. Copie o link e envie manualmente: ${corpo?.linkConvite ?? ''}`,
      });
    } catch {
      setAviso({ ok: false, texto: mensagemDeErro(undefined) });
    } finally {
      setTrabalhando(false);
    }
  }

  async function exportarAuditoria() {
    setExportando(true);
    setAviso(null);
    try {
      const r = await fetch('/api/equipe/auditoria');
      if (!r.ok) throw new Error('auditoria');
      const { eventos } = (await r.json()) as { eventos: EventoDeAuditoria[] };
      const linhas = [['Quando', 'Quem fez', 'Ação', 'Sobre', 'Detalhe'], ...eventos.map((e) => [dataEHora(e.quando), e.ator ?? '', ROTULO_DA_ACAO[e.acao], e.alvo, detalheDoEvento(e)])];
      const texto = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      const url = URL.createObjectURL(new Blob([`\uFEFF${texto}`], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'auditoria-da-equipe.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setAviso({ ok: false, texto: 'Não foi possível exportar a auditoria. Tente de novo.' });
    } finally {
      setExportando(false);
    }
  }

  const gestor = podeGerir(eu);
  const souGerente = eu?.papel === 'GERENTE' && !eu?.isSuperAdmin;
  const total = dados?.total ?? 0;

  return (
    <div className="p-space-md flex flex-col gap-space-md h-[calc(100dvh-4rem)] min-h-[30rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Gestão da Equipe e Acessos</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">Quem tem acesso à empresa, com que papel, e a situação de cada convite.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <button type="button" onClick={() => setPainel('politicas')} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">shield</span>
            Políticas &amp; Perfis
          </button>
          <button type="button" onClick={() => void exportarAuditoria()} disabled={exportando} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2 disabled:opacity-50">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">download</span>
            {exportando ? 'Exportando...' : 'Exportar Auditoria (CSV)'}
          </button>
          <Link href="/equipe/convidar" className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">person_add</span>
            Convidar Usuário
          </Link>
        </div>
      </div>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`shrink-0 font-body-md text-body-md rounded-lg px-3 py-2 break-all ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
        </p>
      )}

      {erro && <EstadoErro mensagem="Não foi possível carregar a equipe. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}
      {dados && (
        <div className="relative flex flex-col gap-space-md flex-1 min-h-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md shrink-0">
            <CartaoIndicador titulo="Total de colaboradores" valor={String(dados.resumo.total)} legenda="na empresa" icone="groups" />
            <CartaoIndicador titulo="Usuários ativos" valor={String(dados.resumo.ativos)} legenda="com acesso" icone="check_circle" cor="success" />
            <CartaoIndicador titulo="Convites pendentes" valor={String(dados.resumo.pendentes)} legenda="aguardando a senha" icone="mark_email_unread" cor="warning" />
            <CartaoIndicador titulo="Inativos" valor={String(dados.resumo.inativos)} legenda="sem acesso" icone="person_off" cor="danger" />
            {dados.assentos?.limite && <CartaoIndicador titulo="Assentos" valor={`${dados.assentos.emUso} de ${dados.assentos.limite}`} legenda="assentos em uso" icone="event_seat" />}
          </div>

          <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-2 flex-wrap shrink-0">
            <input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(1);
              }}
              aria-label="Buscar por nome ou e-mail"
              placeholder="Buscar por nome ou e-mail..."
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md min-w-64 focus:outline-none"
            />
            <select aria-label="Papel" value={papel} onChange={(e) => { setPapel(e.target.value); setPagina(1); }} className="h-10 px-3 rounded-xl bg-surface-subtle">
              <option value="">Todos os Papéis</option>
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select aria-label="Situação" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} className="h-10 px-3 rounded-xl bg-surface-subtle">
              <option value="">Todos os Status</option>
              <option value="ativo">Ativo</option>
              <option value="pendente">Pendente</option>
              <option value="inativo">Inativo</option>
            </select>
            <ItemEmBreve rotulo="Todas as Frentes Comerciais" icone="filter_list" className="h-10 px-3 rounded-xl bg-surface-subtle" />
            <button type="button" onClick={() => { setPapel(''); setStatus(''); setBusca(''); setPagina(1); }} className="h-10 px-3 rounded-xl text-text-muted hover:text-text-primary">
              Limpar
            </button>
          </section>

          {total === 0 ? (
            <section className="bg-surface-card rounded-2xl shadow-sm">
              <EstadoVazio titulo="Nenhum colaborador encontrado" proximoPasso="ajuste os filtros ou convide alguém em Convidar Usuário" icone="groups" />
            </section>
          ) : (
            <section aria-label="Colaboradores" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="overflow-auto flex-1 min-h-0">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle sticky top-0 z-10">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Colaborador</th>
                      <th className="px-space-md py-3">Papel no CRM</th>
                      <th className="px-space-md py-3">Status</th>
                      <th className="px-space-md py-3">Último acesso</th>
                      <th className="px-space-md py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.colaboradores.map((c) => {
                      const ehEu = !!eu?.email && eu.email.toLowerCase() === c.email.toLowerCase();
                      const podeReenviar = c.status === 'pendente' && (gestor || (souGerente && c.papel === 'ATENDENTE'));
                      return (
                        <tr key={c.usuarioId} className={`border-t border-surface-container ${c.status === 'pendente' ? 'bg-warning-surface/20' : ''} ${c.status === 'inativo' ? 'opacity-70' : ''}`}>
                          <td className="px-space-md py-3">
                            <div className="flex items-center gap-3">
                              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center font-label-md text-label-md text-text-secondary overflow-hidden shrink-0">
                                {c.imagem ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.imagem} alt="" className="w-9 h-9 object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  iniciais(c.nome)
                                )}
                              </span>
                              <div className="flex flex-col min-w-0">
                                <span className={`font-label-lg text-label-lg text-text-primary truncate ${c.status === 'inativo' ? 'line-through' : ''}`}>{c.nome}</span>
                                <span className="font-body-sm text-body-sm text-text-muted truncate">{c.email}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-space-md py-3">
                            {gestor && !ehEu ? (
                              <select
                                aria-label={`Papel de ${c.nome}`}
                                value={c.papel}
                                disabled={trabalhando}
                                onChange={(e) => void alterar(c, { papel: e.target.value as Papel })}
                                className={`h-8 px-2 rounded-full font-label-sm text-label-sm ${COR_DO_PAPEL[c.papel]}`}
                              >
                                {PAPEIS.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DO_PAPEL[c.papel]}`}>{c.papel}</span>
                            )}
                          </td>
                          <td className="px-space-md py-3">
                            <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DA_SITUACAO[c.status as Situacao]}`}>{ROTULO_DA_SITUACAO[c.status as Situacao]}</span>
                          </td>
                          <td className="px-space-md py-3 font-body-sm text-body-sm text-text-secondary">{ultimoAcessoTexto(c.ultimoAcesso)}</td>
                          <td className="px-space-md py-3">
                            <div className="flex items-center justify-end gap-2 flex-wrap">
                              {podeReenviar && (
                                <button type="button" disabled={trabalhando} onClick={() => void reenviar(c)} aria-label={`Reenviar convite: ${c.nome}`} className="h-8 px-3 rounded-lg bg-warning-surface text-warning-text font-label-md text-label-md font-semibold disabled:opacity-50">
                                  Reenviar convite
                                </button>
                              )}
                              {gestor && !ehEu && c.papel !== 'MASTER' && c.status !== 'inativo' && (
                                <button type="button" disabled={trabalhando} onClick={() => setEditandoAcessos(c)} aria-label={`Acessos: ${c.nome}`} className="h-8 px-3 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md font-semibold disabled:opacity-50 flex items-center gap-1.5">
                                  <span aria-hidden="true" className="material-symbols-outlined text-[16px]">key</span>
                                  Acessos
                                  {c.modulos && <span className="px-1.5 rounded-full bg-warning-surface text-warning-text font-label-sm text-[10px]">personalizado</span>}
                                </button>
                              )}
                              {gestor && !ehEu && (
                                <button
                                  type="button"
                                  disabled={trabalhando}
                                  onClick={() => setAConfirmar(c)}
                                  aria-label={`${c.status === 'inativo' ? 'Reativar' : 'Desativar'}: ${c.nome}`}
                                  className={`h-8 px-3 rounded-lg font-label-md text-label-md font-semibold disabled:opacity-50 ${c.status === 'inativo' ? 'bg-success-surface text-success-text' : 'bg-danger-surface text-danger-text'}`}
                                >
                                  {c.status === 'inativo' ? 'Reativar' : 'Desativar'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={total} onMudarPagina={setPagina} rotuloItem="colaboradores" />
            </section>
          )}

          <section className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center justify-end gap-2 flex-wrap shrink-0">
            <button type="button" onClick={() => setPainel('auditoria')} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">history</span>
              Logs de Auditoria
            </button>
            <button type="button" onClick={() => setPainel('sessao')} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">shield</span>
              Sessão e acesso
            </button>
          </section>
        </div>
      )}
      {editandoAcessos && (
        <DialogoDeAcessos
          colaborador={editandoAcessos}
          onFechar={() => setEditandoAcessos(null)}
          onSalvo={(texto) => {
            setEditandoAcessos(null);
            setAviso({ ok: true, texto });
            void carregar();
          }}
        />
      )}
      {painel === 'politicas' && <DialogoDePoliticas onFechar={() => setPainel(null)} />}
      {painel === 'auditoria' && <DialogoDeAuditoria onFechar={() => setPainel(null)} />}
      {painel === 'sessao' && <DialogoDeSessao onFechar={() => setPainel(null)} />}

      {aConfirmar && (
        <Dialog open onOpenChange={(aberto) => !aberto && setAConfirmar(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{aConfirmar.status === 'inativo' ? 'Reativar colaborador' : 'Desativar colaborador'}</DialogTitle>
              <DialogDescription>
                {aConfirmar.status === 'inativo'
                  ? `${aConfirmar.nome} volta a ter acesso a esta empresa.`
                  : `${aConfirmar.nome} perde o acesso a esta empresa agora. O histórico dele (cards, mensagens) é mantido.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAConfirmar(null)}>
                Cancelar
              </Button>
              <Button disabled={trabalhando} onClick={() => void alterar(aConfirmar, { ativo: aConfirmar.status === 'inativo' })}>
                {aConfirmar.status === 'inativo' ? 'Reativar' : 'Desativar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

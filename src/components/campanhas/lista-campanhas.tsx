'use client';

// T-197 (fase4-campanhas, US-129): tela "Campanhas de Comunicação & Mala Direta" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/20._campanhas_mala_direta_e_campanhas/`.
// O servidor faz o filtro, a busca e a paginação (`GET /api/campanhas`, AC-533);
// os indicadores vêm de `resumo` (AC-534). Só MASTER/GERENTE (ASM-185).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { OPCOES_POR_PAGINA, Paginacao } from '@/components/pipeline/pecas/paginacao';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  COR_DA_CAMPANHA,
  ROTULO_DA_CAMPANHA,
  formatarData,
  formatarPorcentagem,
  mensagemDeErro,
  porcentagemDe,
  totalEnviados,
  type CampanhaDaLista,
  type ResumoView,
} from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';

const INTERVALO_MS = 15_000;

interface Resposta {
  campanhas: CampanhaDaLista[];
  total: number;
  resumo: ResumoView;
}

export function ListaCampanhas() {
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [dias, setDias] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(OPCOES_POR_PAGINA[0]);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [restrito, setRestrito] = useState(false);
  const [aExcluir, setAExcluir] = useState<CampanhaDaLista | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams({ pagina: String(pagina), porPagina: String(porPagina) });
    if (status) q.set('status', status);
    if (busca.trim()) q.set('busca', busca.trim());
    if (dias) q.set('dias', dias);
    try {
      const r = await fetch(`/api/campanhas?${q.toString()}`);
      if (r.status === 403) {
        setRestrito(true);
        return;
      }
      if (!r.ok) throw new Error(`campanhas respondeu ${r.status}`);
      setDados((await r.json()) as Resposta);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [pagina, porPagina, status, busca, dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // AC-538: relê sozinho, só enquanto houver campanha enviando.
  const enviando = dados?.campanhas.some((c) => c.status === 'PROCESSANDO') ?? false;
  useEffect(() => {
    if (!enviando) return;
    const timer = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(timer);
  }, [enviando, carregar]);

  function limpar() {
    setStatus('');
    setBusca('');
    setDias('');
    setPagina(1);
  }

  async function excluir() {
    if (!aExcluir) return;
    setExcluindo(true);
    setErroExclusao(null);
    try {
      const r = await fetch(`/api/campanhas/${aExcluir.id}`, { method: 'DELETE' });
      if (r.ok) {
        setAExcluir(null);
        await carregar();
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
      setErroExclusao(mensagemDeErro(corpo?.codigo));
    } catch {
      setErroExclusao(mensagemDeErro(undefined));
    } finally {
      setExcluindo(false);
    }
  }

  const cabecalho = (
    <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Campanhas de Comunicação &amp; Mala Direta</h1>
        <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-xl">Envios em lote por e-mail para a base de leads, com o acompanhamento de cada disparo.</p>
      </div>
      {!restrito && (
        <div className="flex items-center gap-space-sm flex-wrap">
          <ItemEmBreve rotulo="Exportar Histórico (CSV)" icone="download" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
          <Link href="/campanhas/nova" className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">add</span>
            Nova Campanha
          </Link>
        </div>
      )}
    </div>
  );

  if (restrito) {
    return (
      <div className="p-space-md space-y-space-md">
        {cabecalho}
        <EstadoVazio titulo="Campanhas são para gerente e master" proximoPasso="peça a um gerente para acompanhar os envios" icone="lock" />
      </div>
    );
  }

  const semFiltro = !status && !busca.trim() && !dias;

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      {cabecalho}

      {erro && <EstadoErro mensagem="Não foi possível carregar as campanhas. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && dados === null && <EsqueletoCarregando />}
      {!erro && dados !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md shrink-0">
            <CartaoIndicador titulo="Total de disparos no mês" valor={dados.resumo.disparosNoMes.toLocaleString('pt-BR')} legenda="e-mails enviados neste mês" icone="outgoing_mail" />
            <CartaoIndicador titulo="Taxa média de entrega" valor={formatarPorcentagem(dados.resumo.taxaEntrega)} legenda="enviados sem falha" icone="verified" cor="success" />
            <CartaoIndicador titulo="Taxa de abertura global" valor={formatarPorcentagem(dados.resumo.taxaAbertura)} legenda="sobre os enviados" icone="drafts" cor="info" />
            <CartaoIndicador titulo="Taxa de cliques (CTR)" valor={formatarPorcentagem(dados.resumo.taxaCliques)} legenda="sobre os enviados" icone="ads_click" cor="warning" />
          </div>

          <section aria-label="Filtros" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-center gap-2 flex-wrap shrink-0">
            <input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(1);
              }}
              aria-label="Buscar por nome da campanha ou assunto"
              placeholder="Buscar por nome da campanha ou assunto..."
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md min-w-64 focus:outline-none"
            />
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPagina(1);
              }}
              className="h-10 px-3 rounded-xl bg-surface-subtle"
            >
              <option value="">Todos os Status</option>
              <option value="rascunho">Rascunho</option>
              <option value="enviando">Enviando</option>
              <option value="concluida">Concluída</option>
            </select>
            <select
              aria-label="Período"
              value={dias}
              onChange={(e) => {
                setDias(e.target.value);
                setPagina(1);
              }}
              className="h-10 px-3 rounded-xl bg-surface-subtle"
            >
              <option value="">Todo o período</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
            </select>
            <button type="button" onClick={limpar} className="h-10 px-3 rounded-xl text-text-muted hover:text-text-primary">
              Limpar
            </button>
          </section>

          {dados.total === 0 ? (
            semFiltro ? (
              <section className="bg-surface-card rounded-2xl shadow-sm">
                <EstadoVazio titulo="Nenhuma campanha ainda" proximoPasso="crie a primeira em + Nova Campanha" icone="mail" />
              </section>
            ) : (
              <p className="font-body-md text-body-md text-text-secondary">Nenhuma campanha encontrada</p>
            )
          ) : (
            <section aria-label="Campanhas" className="bg-surface-card rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-subtle sticky top-0 z-10">
                    <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                      <th className="px-space-md py-3">Campanha &amp; assunto</th>
                      <th className="px-space-md py-3">Destinatários</th>
                      <th className="px-space-md py-3">Status</th>
                      <th className="px-space-md py-3">Total enviado</th>
                      <th className="px-space-md py-3">Abertura</th>
                      <th className="px-space-md py-3">Cliques</th>
                      <th className="px-space-md py-3">Criada em</th>
                      <th className="px-space-md py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.campanhas.map((c) => {
                      const enviados = totalEnviados(c.contagens);
                      const andamento = porcentagemDe(enviados + c.contagens.erro, c.totalDestinatarios);
                      return (
                        <tr key={c.id} className="border-t border-surface-container align-top">
                          <td className="px-space-md py-3 max-w-xs">
                            <Link href={`/campanhas/${c.id}`} className="font-label-lg text-label-lg text-text-primary hover:text-primary">
                              {c.nome}
                            </Link>
                            <p className="font-body-sm text-body-sm text-text-muted truncate">Assunto: {c.assunto}</p>
                          </td>
                          <td className="px-space-md py-3 font-body-md text-body-md">{c.totalDestinatarios.toLocaleString('pt-BR')}</td>
                          <td className="px-space-md py-3">
                            <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DA_CAMPANHA[c.status] ?? COR_DA_CAMPANHA.RASCUNHO}`}>{ROTULO_DA_CAMPANHA[c.status] ?? c.status}</span>
                            {c.status === 'PROCESSANDO' && (
                              <div className="mt-2 flex flex-col gap-1">
                                <div role="progressbar" aria-valuenow={Math.round(andamento ?? 0)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-28 rounded-full bg-surface-container overflow-hidden">
                                  <div className="h-full bg-primary" style={{ width: `${andamento ?? 0}%` }} />
                                </div>
                                <span className="font-body-sm text-[11px] text-text-muted">{Math.round(andamento ?? 0)}% concluído</span>
                              </div>
                            )}
                          </td>
                          <td className="px-space-md py-3 font-body-md text-body-md">
                            {c.status === 'RASCUNHO' ? (
                              <span className="text-text-muted">Não enviado</span>
                            ) : (
                              <>
                                {enviados.toLocaleString('pt-BR')} / {c.totalDestinatarios.toLocaleString('pt-BR')}
                                {c.contagens.pendente > 0 && <p className="font-body-sm text-[11px] text-text-muted">na fila: {c.contagens.pendente}</p>}
                                {c.contagens.pausado > 0 && <p className="font-body-sm text-[11px] text-warning-text">pausados: {c.contagens.pausado}</p>}
                                {c.contagens.descadastrado > 0 && <p className="font-body-sm text-[11px] text-text-muted">descadastrados: {c.contagens.descadastrado}</p>}
                                {c.contagens.erro > 0 && <p className="font-body-sm text-[11px] text-danger-text">{c.contagens.erro} {c.contagens.erro === 1 ? 'falha' : 'falhas'}</p>}
                              </>
                            )}
                          </td>
                          <td className="px-space-md py-3 font-body-md text-body-md">{formatarPorcentagem(porcentagemDe(c.contagens.aberto + c.contagens.clicado, enviados))}</td>
                          <td className="px-space-md py-3 font-body-md text-body-md">{formatarPorcentagem(porcentagemDe(c.contagens.clicado, enviados))}</td>
                          <td className="px-space-md py-3 font-body-sm text-body-sm text-text-muted">{formatarData(c.criadoEm)}</td>
                          <td className="px-space-md py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Link href={`/campanhas/${c.id}`} aria-label={`Abrir ${c.nome}`} className="w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-subtle flex items-center justify-center">
                                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">open_in_new</span>
                              </Link>
                              {c.status !== 'PROCESSANDO' && c.status !== 'PAUSADA' && (
                                <button
                                  type="button"
                                  aria-label={`Excluir ${c.nome}`}
                                  onClick={() => {
                                    setErroExclusao(null);
                                    setAExcluir(c);
                                  }}
                                  className="w-8 h-8 rounded-lg text-danger-text hover:bg-danger-surface flex items-center justify-center"
                                >
                                  <span aria-hidden="true" className="material-symbols-outlined text-[20px]">delete</span>
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
              <Paginacao
                pagina={pagina}
                porPagina={porPagina}
                total={dados.total}
                onMudarPagina={setPagina}
                rotuloItem="campanhas"
                opcoesPorPagina={OPCOES_POR_PAGINA}
                onMudarPorPagina={(valor) => {
                  setPorPagina(valor);
                  setPagina(1);
                }}
              />
            </section>
          )}

          <ItemEmBreve rotulo="Auditar Entregabilidade" icone="shield" className="self-start shrink-0" />
        </>
      )}

      {aExcluir && (
        <Dialog open onOpenChange={(aberto) => !aberto && setAExcluir(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir campanha</DialogTitle>
              <DialogDescription>
                Excluir &quot;{aExcluir.nome}&quot; apaga também os {aExcluir.totalDestinatarios} destinatários dela. Isso não pode ser desfeito.
              </DialogDescription>
            </DialogHeader>
            {erroExclusao && (
              <p role="alert" className="text-sm text-danger-text">
                {erroExclusao}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAExcluir(null)}>
                Cancelar
              </Button>
              <Button onClick={() => void excluir()} disabled={excluindo}>
                {excluindo ? 'Excluindo...' : 'Excluir'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

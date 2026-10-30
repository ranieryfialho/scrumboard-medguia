'use client';

// T-199 (fase4-campanhas, US-131): tela de detalhe e acompanhamento da campanha —
// fonte visual `docs/ui/stitch_medcrm_interface_design/22._campanhas_id_detalhe_e_acompanhamento_da_campanha/`.
// Usa as rotas que já existem: `GET /api/campanhas/[id]` (com `criadoPorNome`),
// `POST .../iniciar` (Play, com confirmação), `POST .../reenviar-falhas` e `DELETE`.
// O CRM só libera a fila: quem envia é o motor externo (ASM-189). Relê a cada 15 s
// enquanto a campanha está "Enviando" (AC-552).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { descreverMeta } from '@/lib/metas/catalogo';
import { useMetas } from '@/lib/metas/usar-metas';
import { useRouter } from 'next/navigation';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { Paginacao } from '@/components/pipeline/pecas/paginacao';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  COR_DA_CAMPANHA,
  ATALHO_DA_CHAVE,
  COR_DO_DESTINATARIO,
  MOTIVO_DA_FALHA,
  ROTULO_DA_CAMPANHA,
  ROTULO_DO_DESTINATARIO,
  formatarData,
  formatarPorcentagem,
  iniciais,
  mensagemDeErro,
  porcentagemDe,
  type ContagensView,
} from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { PreviaEmail } from './previa-email';

const POR_PAGINA = 20;
const INTERVALO_MS = 15_000;

interface DetalheView {
  campanha: { id: string; nome: string; assunto: string; corpoHtml: string; status: string; criadoEm: string; criadoPorNome: string | null };
  destinatarios: { id: string; nome: string; email: string; status: string; tentativas: number; enviadoEm: string | null; erro?: string | null }[];
  contagemPorStatus: Record<string, number>;
}

type FiltroDestinatarios = 'todos' | 'abertos' | 'clicados' | 'enviados' | 'falhas';
type Aba = 'destinatarios' | 'previa';

const FILTROS: { id: FiltroDestinatarios; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'abertos', rotulo: 'Abertos' },
  { id: 'clicados', rotulo: 'Clicados' },
  { id: 'enviados', rotulo: 'Enviados/Não abertos' },
  { id: 'falhas', rotulo: 'Falhas' },
];

function doFiltro(status: string, filtro: FiltroDestinatarios): boolean {
  if (filtro === 'todos') return true;
  if (filtro === 'abertos') return status === 'ABERTO' || status === 'CLICADO';
  if (filtro === 'clicados') return status === 'CLICADO';
  if (filtro === 'enviados') return status === 'ENVIADO';
  return status === 'ERRO';
}

export function DetalheCampanha({ id }: { id: string }) {
  const metas = useMetas();
  const router = useRouter();
  const [dados, setDados] = useState<DetalheView | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro' | 'nao-encontrada' | 'restrito'>('carregando');
  const [aba, setAba] = useState<Aba>('destinatarios');
  const [filtro, setFiltro] = useState<FiltroDestinatarios>('todos');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [confirmando, setConfirmando] = useState<'iniciar' | 'excluir' | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string; atalhoDaChave?: boolean } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/campanhas/${id}`);
      if (r.status === 404) return setEstado('nao-encontrada');
      if (r.status === 403) return setEstado('restrito');
      if (!r.ok) throw new Error(`campanha respondeu ${r.status}`);
      setDados((await r.json()) as DetalheView);
      setEstado('ok');
    } catch {
      setEstado('erro');
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const enviando = dados?.campanha.status === 'PROCESSANDO';
  useEffect(() => {
    if (!enviando) return;
    const timer = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(timer);
  }, [enviando, carregar]);

  const contagens: ContagensView = useMemo(() => {
    const c = dados?.contagemPorStatus ?? {};
    return { rascunho: c.RASCUNHO ?? 0, pendente: c.PENDENTE ?? 0, enviado: c.ENVIADO ?? 0, aberto: c.ABERTO ?? 0, clicado: c.CLICADO ?? 0, erro: c.ERRO ?? 0, enviando: c.ENVIANDO ?? 0, pausado: c.PAUSADO ?? 0, descadastrado: c.DESCADASTRADO ?? 0 };
  }, [dados]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (dados?.destinatarios ?? []).filter(
      (d) => doFiltro(d.status, filtro) && (!termo || d.nome.toLowerCase().includes(termo) || d.email.toLowerCase().includes(termo))
    );
  }, [dados, filtro, busca]);

  async function chamar(caminho: string, metodo: 'POST' | 'DELETE', sucesso: string) {
    setTrabalhando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/campanhas/${id}${caminho}`, { method: metodo });
      if (r.ok) {
        if (metodo === 'DELETE') {
          router.push('/campanhas');
          return;
        }
        setAviso({ ok: true, texto: sucesso });
        await carregar();
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
      setAviso({ ok: false, texto: mensagemDeErro(corpo?.codigo), atalhoDaChave: corpo?.codigo === 'CHAVE_RESEND_NAO_CONFIGURADA' });
    } catch {
      setAviso({ ok: false, texto: mensagemDeErro(undefined) });
    } finally {
      setTrabalhando(false);
      setConfirmando(null);
    }
  }

  if (estado === 'carregando') return <div className="p-space-md"><EsqueletoCarregando /></div>;
  if (estado === 'erro') return <div className="p-space-md"><EstadoErro mensagem="Não foi possível carregar a campanha. Tente de novo." onTentarDeNovo={carregar} /></div>;
  if (estado === 'nao-encontrada') {
    return (
      <div className="p-space-md">
        <EstadoVazio titulo="Campanha não encontrada" proximoPasso="volte para a lista de campanhas" icone="search_off" />
        <Link href="/campanhas" className="font-label-md text-label-md text-primary font-semibold hover:underline">Voltar</Link>
      </div>
    );
  }
  if (estado === 'restrito' || !dados) {
    return <div className="p-space-md"><EstadoVazio titulo="Campanhas são para gerente e master" proximoPasso="peça a um gerente para acompanhar os envios" icone="lock" /></div>;
  }

  const { campanha } = dados;
  const total = dados.destinatarios.length;
  const enviados = contagens.enviado + contagens.aberto + contagens.clicado;
  const naFila = contagens.pendente + contagens.rascunho + contagens.enviando;
  const pausada = campanha.status === 'PAUSADA';
  const concluido = porcentagemDe(enviados + contagens.erro, total) ?? 0;
  const podeIniciar = campanha.status === 'RASCUNHO' && total > 0;

  return (
    <div className="p-space-md space-y-space-md">
      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm flex items-start justify-between flex-wrap gap-space-md">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/campanhas" className="font-label-md text-label-md text-primary font-semibold hover:underline">Voltar</Link>
            <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DA_CAMPANHA[campanha.status] ?? COR_DA_CAMPANHA.RASCUNHO}`}>{ROTULO_DA_CAMPANHA[campanha.status] ?? campanha.status}</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">{campanha.nome}</h1>
          <p className="font-body-md text-body-md text-text-secondary">Assunto: {campanha.assunto}</p>
          <p className="font-body-sm text-body-sm text-text-muted">
            Criada em {formatarData(campanha.criadoEm)}
            {campanha.criadoPorNome ? ` · Criada por ${campanha.criadoPorNome}` : ''} · {total} destinatários
          </p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          {campanha.status === 'RASCUNHO' && (
            <Link href={`/campanhas/nova?rascunho=${campanha.id}`} className="h-10 px-4 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center">
              Editar
            </Link>
          )}
          <button
            type="button"
            disabled={!podeIniciar || trabalhando}
            onClick={() => setConfirmando('iniciar')}
            className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50"
          >
            Iniciar Disparo
          </button>
          {contagens.erro > 0 && !pausada && (
            <button type="button" disabled={trabalhando} onClick={() => void chamar('/reenviar-falhas', 'POST', 'As falhas voltaram para a fila.')} className="h-10 px-4 rounded-xl bg-warning-surface text-warning-text font-label-md text-label-md font-semibold disabled:opacity-50">
              Reenviar Falhas ({contagens.erro})
            </button>
          )}
          {enviando && (
            <button type="button" disabled={trabalhando} onClick={() => void chamar('/pausar', 'POST', 'Campanha pausada: quem ainda não recebeu fica aguardando.')} className="h-10 px-4 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50">
              Pausar
            </button>
          )}
          {pausada && (
            <button type="button" disabled={trabalhando} onClick={() => void chamar('/retomar', 'POST', 'Campanha retomada: os pausados voltaram para a fila.')} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50">
              Retomar
            </button>
          )}
          <ItemEmBreve rotulo="CSV" icone="download" className="h-10 px-4 rounded-xl bg-surface-subtle" />
          {campanha.status !== 'PROCESSANDO' && !pausada && (
            <button type="button" onClick={() => setConfirmando('excluir')} className="h-10 px-4 rounded-xl bg-danger-surface text-danger-text font-label-md text-label-md font-semibold">
              Excluir
            </button>
          )}
        </div>
      </section>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
          {aviso.atalhoDaChave && (
            <>
              {' '}
              <Link href={ATALHO_DA_CHAVE} className="font-semibold underline">Configurar a chave</Link>
            </>
          )}
        </p>
      )}

      <section aria-label="Progresso do envio" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
        <div className="flex items-center justify-between font-body-sm text-body-sm text-text-secondary">
          <span>{enviando ? 'Transmissão em fila ativa' : 'Envio'}: {enviados} de {total} e-mails enviados</span>
          <span>{Math.round(concluido)}% concluído</span>
        </div>
        <div role="progressbar" aria-valuenow={Math.round(concluido)} aria-valuemin={0} aria-valuemax={100} className="h-2 rounded-full bg-surface-container overflow-hidden flex">
          <div className="h-full bg-primary" style={{ width: `${porcentagemDe(enviados, total) ?? 0}%` }} />
          <div className="h-full bg-danger-text" style={{ width: `${porcentagemDe(contagens.erro, total) ?? 0}%` }} />
        </div>
        <div className="flex gap-4 font-body-sm text-body-sm text-text-muted flex-wrap">
          <span>{enviados} enviados</span>
          <span>{naFila} na fila</span>
          <span>{contagens.erro} falhas</span>
          <span>{contagens.pausado} pausados</span>
          <span>{contagens.descadastrado} descadastrados</span>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
        <CartaoIndicador titulo="Volume total de disparo" valor={String(total)} legenda={`${enviados} enviados · ${naFila} na fila · ${contagens.erro} falhas`} icone="outgoing_mail" />
        <CartaoIndicador titulo="Taxa de entrega" valor={formatarPorcentagem(porcentagemDe(enviados, enviados + contagens.erro))} legenda="enviados sem falha" icone="verified" cor="success" meta={descreverMeta(porcentagemDe(enviados, enviados + contagens.erro), metas.taxa_entrega_email)} />
        <CartaoIndicador titulo="Taxa de abertura única" valor={formatarPorcentagem(porcentagemDe(contagens.aberto + contagens.clicado, enviados))} legenda={`${contagens.aberto + contagens.clicado} abriram`} icone="drafts" cor="info" meta={descreverMeta(porcentagemDe(contagens.aberto + contagens.clicado, enviados), metas.taxa_abertura_email)} />
        <CartaoIndicador titulo="Taxa de cliques" valor={formatarPorcentagem(porcentagemDe(contagens.clicado, enviados))} legenda={`${contagens.clicado} cliques únicos`} icone="ads_click" cor="warning" meta={descreverMeta(porcentagemDe(contagens.clicado, enviados), metas.taxa_cliques_email)} />
      </div>

      {contagens.erro > 0 && (
        <section aria-label="Aviso de falhas" className="bg-warning-surface rounded-2xl p-space-md flex items-center justify-between gap-3 flex-wrap">
          <p className="font-body-md text-body-md text-warning-text">
            {contagens.erro} {contagens.erro === 1 ? 'disparo apresentou falha' : 'disparos apresentaram falha'} de entrega.
          </p>
          <button type="button" disabled={trabalhando} onClick={() => void chamar('/reenviar-falhas', 'POST', 'As falhas voltaram para a fila.')} className="h-10 px-4 rounded-xl bg-warning-text text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50">
            Reenviar {contagens.erro} {contagens.erro === 1 ? 'Falha' : 'Falhas'} Agora
          </button>
        </section>
      )}

      <section className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
        <div role="tablist" aria-label="Seções da campanha" className="flex items-center gap-2 flex-wrap">
          <button type="button" role="tab" aria-selected={aba === 'destinatarios'} onClick={() => setAba('destinatarios')} className={`h-9 px-3 rounded-lg font-label-md text-label-md ${aba === 'destinatarios' ? 'bg-primary text-on-primary font-semibold' : 'bg-surface-subtle text-text-secondary'}`}>
            Destinatários e Status Individual ({total})
          </button>
          <button type="button" role="tab" aria-selected={aba === 'previa'} onClick={() => setAba('previa')} className={`h-9 px-3 rounded-lg font-label-md text-label-md ${aba === 'previa' ? 'bg-primary text-on-primary font-semibold' : 'bg-surface-subtle text-text-secondary'}`}>
            Conteúdo Enviado (Prévia)
          </button>
          <ItemEmBreve rotulo="Mapa de Calor de Cliques e Links" className="h-9 px-3 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Eventos em Linha do Tempo (Log)" className="h-9 px-3 rounded-lg bg-surface-subtle" />
        </div>

        {aba === 'previa' ? (
          <PreviaEmail assunto={campanha.assunto} corpoHtml={campanha.corpoHtml} largura="desktop" />
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="search"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setPagina(1);
                }}
                aria-label="Buscar por nome ou e-mail"
                placeholder="Buscar por nome ou e-mail..."
                className="h-9 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md focus:outline-none"
              />
              <div role="group" aria-label="Filtro de destinatários" className="flex items-center gap-1 flex-wrap">
                {FILTROS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filtro === f.id}
                    onClick={() => {
                      setFiltro(f.id);
                      setPagina(1);
                    }}
                    className={`h-8 px-3 rounded-full font-label-md text-label-md ${filtro === f.id ? 'bg-primary text-on-primary font-semibold' : 'bg-surface-subtle text-text-secondary'}`}
                  >
                    {f.rotulo} ({dados.destinatarios.filter((d) => doFiltro(d.status, f.id)).length})
                  </button>
                ))}
              </div>
            </div>

            {total === 0 ? (
              <EstadoVazio titulo="Nenhum destinatário" proximoPasso="esta campanha não tem destinatários" icone="group" />
            ) : visiveis.length === 0 ? (
              <p className="font-body-md text-body-md text-text-secondary">Nenhum destinatário neste filtro</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-subtle">
                      <tr className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">
                        <th className="px-space-md py-3">Destinatário</th>
                        <th className="px-space-md py-3">Status do disparo</th>
                        <th className="px-space-md py-3">Tentativas</th>
                        <th className="px-space-md py-3">Enviado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((d) => (
                        <tr key={d.id} className={`border-t border-surface-container ${d.status === 'ERRO' ? 'bg-danger-surface/30' : ''}`}>
                          <td className="px-space-md py-3">
                            <div className="flex items-center gap-3">
                              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center font-label-md text-label-md text-text-secondary">{iniciais(d.nome)}</span>
                              <div className="flex flex-col min-w-0">
                                <span className="font-label-lg text-label-lg text-text-primary truncate">{d.nome}</span>
                                <span className="font-body-sm text-body-sm text-text-muted truncate">{d.email}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-space-md py-3">
                            <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR_DO_DESTINATARIO[d.status] ?? COR_DO_DESTINATARIO.RASCUNHO}`}>{ROTULO_DO_DESTINATARIO[d.status] ?? d.status}</span>
                            {d.status === 'ERRO' && d.erro && (
                              <p className="mt-1 font-body-sm text-body-sm text-danger-text">
                                {MOTIVO_DA_FALHA[d.erro] ?? d.erro}
                                {d.erro === 'SEM_CHAVE_RESEND' && (
                                  <>
                                    {' '}
                                    <Link href={ATALHO_DA_CHAVE} className="font-semibold underline">Configurar</Link>
                                  </>
                                )}
                              </p>
                            )}
                          </td>
                          <td className="px-space-md py-3 font-body-md text-body-md">{d.tentativas}</td>
                          <td className="px-space-md py-3 font-body-sm text-body-sm text-text-muted">{d.enviadoEm ? formatarData(d.enviadoEm) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={visiveis.length} onMudarPagina={setPagina} rotuloItem="destinatários" />
              </>
            )}
          </>
        )}
      </section>

      {confirmando && (
        <Dialog open onOpenChange={(aberto) => !aberto && setConfirmando(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmando === 'iniciar' ? 'Iniciar disparo' : 'Excluir campanha'}</DialogTitle>
              <DialogDescription>
                {confirmando === 'iniciar'
                  ? `Os ${total} destinatários entram na fila de envio agora. Depois de iniciar, a campanha não pode mais ser editada.`
                  : `Excluir "${campanha.nome}" apaga também os ${total} destinatários dela. Isso não pode ser desfeito.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmando(null)}>
                Cancelar
              </Button>
              <Button
                disabled={trabalhando}
                onClick={() => (confirmando === 'iniciar' ? void chamar('/iniciar', 'POST', 'Disparo iniciado: a fila foi liberada para o envio.') : void chamar('', 'DELETE', ''))}
              >
                {confirmando === 'iniciar' ? 'Iniciar' : 'Excluir'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

'use client';

// T-190 (fase4-whatsapp, US-124): tela "Central de Atendimento WhatsApp" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/16._whatsapp_caixa_de_entrada/`.
// Dados: `GET /api/whatsapp/conversas` (lista, abas, busca e indicadores),
// `GET /api/whatsapp/status` (selo da conexão) e, na conversa aberta, as APIs de
// mensagens, envio e leitura que já existem. Relê tudo a cada 15 s e ao chegar
// `mensagem.recebida` do fluxo de eventos (AC-508).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { whatsappConectado, type StatusDoWhatsapp } from '@/components/pipeline/conversa/faixa-conexao';
import { EVENTO_CONTADORES_MUDARAM } from '@/components/shell/use-contadores';
import { saoNumerosEquivalentes, normalizarNumero } from '@/domain/whatsapp/numero';
import { ContextoCard } from './contexto-card';
import { duracaoCurta, type ConversaView, type RespostaConversasView } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { ListaConversas, type AbaConversas } from './lista-conversas';
import { PainelConversa } from './painel-conversa';

const INTERVALO_MS = 15_000;

const META_TEMPO_SEG = 300;
const META_TAXA = 90;

function CartaoKpi({ titulo, icone, corIcone, valor, destaque, legenda, barra }: { titulo: string; icone: string; corIcone: string; valor: string; destaque?: { texto: string; classe: string } | null; legenda?: string; barra?: { pct: number; classe: string } }) {
  return (
    <div className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">{titulo}</span>
        <span aria-hidden="true" className={`material-symbols-outlined text-[22px] ${corIcone}`}>{icone}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="font-metric-stat text-metric-stat text-text-primary">{valor}</span>
        {destaque && <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm ${destaque.classe}`}>{destaque.texto}</span>}
      </div>
      {barra ? (
        <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
          <div className={`h-full rounded-full ${barra.classe}`} style={{ width: `${Math.min(100, Math.max(0, barra.pct))}%` }} />
        </div>
      ) : (
        <span className="font-body-sm text-body-sm text-text-muted">{legenda}</span>
      )}
    </div>
  );
}

function seloDaConexao(status: StatusDoWhatsapp | null): { texto: string; classe: string; ponto: string } {
  if (!status) return { texto: 'Verificando a conexão...', classe: 'bg-surface-container text-text-secondary', ponto: 'bg-text-muted' };
  if (whatsappConectado(status)) {
    return { texto: `Evolution API Conectada${status.instance ? ` (Instância ${status.instance})` : ''}`, classe: 'bg-success-surface text-success-text', ponto: 'bg-success-text' };
  }
  if (status.state === 'not_configured') return { texto: 'WhatsApp não configurado', classe: 'bg-warning-surface text-warning-text', ponto: 'bg-warning-text' };
  return { texto: 'Evolution API desconectada', classe: 'bg-danger-surface text-danger-text', ponto: 'bg-danger-text' };
}

export function CaixaDeEntrada() {
  const parametros = useSearchParams();
  const leadIdDaUrl = parametros.get('leadId');
  const numeroDaUrl = parametros.get('numero');

  const [aba, setAba] = useState<AbaConversas>('todas');
  const [busca, setBusca] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [dados, setDados] = useState<RespostaConversasView | null>(null);
  const [erro, setErro] = useState(false);
  const [status, setStatus] = useState<StatusDoWhatsapp | null>(null);
  const [latenciaMs, setLatenciaMs] = useState<number | null>(null);
  const [selecionada, setSelecionada] = useState<ConversaView | null>(null);
  const [versao, setVersao] = useState(0);
  const [podeFiltrar, setPodeFiltrar] = useState(false);
  const [responsaveis, setResponsaveis] = useState<{ id: string; nome: string }[]>([]);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const urlAplicada = useRef(false);

  const carregar = useCallback(async () => {
    const q = new URLSearchParams({ filtro: aba });
    if (busca.trim()) q.set('busca', busca.trim());
    if (responsavelId) q.set('responsavelId', responsavelId);
    try {
      const r = await fetch(`/api/whatsapp/conversas?${q.toString()}`);
      if (!r.ok) throw new Error(`conversas respondeu ${r.status}`);
      setDados((await r.json()) as RespostaConversasView);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [aba, busca, responsavelId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const recarregarTudo = useCallback(() => {
    void carregar();
    setVersao((v) => v + 1);
  }, [carregar]);

  // AC-508: 15 s e `mensagem.recebida`.
  useEffect(() => {
    const timer = setInterval(recarregarTudo, INTERVALO_MS);
    let origem: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      origem = new EventSource('/api/stream');
      origem.addEventListener('mensagem.recebida', recarregarTudo);
    }
    return () => {
      clearInterval(timer);
      origem?.close();
    };
  }, [recarregarTudo]);

  useEffect(() => {
    let cancelado = false;
    const lerStatus = () => {
      const inicio = performance.now();
      return fetch('/api/whatsapp/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((s: StatusDoWhatsapp | null) => {
          if (cancelado) return;
          setStatus(s);
          if (s) setLatenciaMs(Math.round(performance.now() - inicio));
        })
        .catch(() => undefined);
    };
    void lerStatus();
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (u: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (cancelado || !u) return;
        const gerente = u.isSuperAdmin === true || u.papel === 'MASTER' || u.papel === 'GERENTE';
        setPodeFiltrar(gerente);
        if (!gerente) return;
        const r = await fetch('/api/pipeline/responsaveis');
        if (r.ok && !cancelado) setResponsaveis(((await r.json()) as { responsaveis: { id: string; nome: string }[] }).responsaveis);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  // Vindo da tela de avulsa (ou de um link): abre a conversa pedida na URL, uma vez.
  useEffect(() => {
    if (urlAplicada.current || !dados) return;
    if (!leadIdDaUrl && !numeroDaUrl) return;
    urlAplicada.current = true;
    const numero = numeroDaUrl ? normalizarNumero(numeroDaUrl) : null;
    const achada = dados.conversas.find((c) => (leadIdDaUrl ? c.leadId === leadIdDaUrl : numero ? saoNumerosEquivalentes(c.numero, numero) : false));
    if (achada) setSelecionada(achada);
    else if (numero) {
      setSelecionada({ chave: numero, leadId: null, numero, nome: null, ultimaMensagem: '', ultimaEm: new Date().toISOString(), ultimaDirecao: 'enviada', naoLidas: 0, respondida: false, card: null });
    }
  }, [dados, leadIdDaUrl, numeroDaUrl]);

  async function marcarTodas() {
    setMarcandoTodas(true);
    try {
      const r = await fetch('/api/whatsapp/lidas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ todas: true }) });
      if (r.ok) {
        window.dispatchEvent(new Event(EVENTO_CONTADORES_MUDARAM));
        recarregarTudo();
      }
    } finally {
      setMarcandoTodas(false);
    }
  }

  // A conversa aberta acompanha a lista (não lidas, card); fora dela (outra aba), usa a última cópia.
  const aberta = selecionada ? (dados?.conversas.find((c) => c.chave === selecionada.chave) ?? selecionada) : null;
  const selo = seloDaConexao(status);

  const ind = dados?.indicadores;
  const tempo = ind?.tempoPrimeiraRespostaSeg ?? null;
  const taxa = ind?.taxaResposta ?? null;
  const ativas = dados?.resumo.ativasHoje ?? 0;
  const total = dados?.contagens.todas ?? 0;
  const naoLidas = dados?.resumo.naoLidas ?? 0;

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div className="flex flex-col gap-1">
          <nav aria-label="Caminho" className="font-label-sm text-label-sm uppercase tracking-wider text-text-muted">
            Comunicação / WhatsApp / <span className="text-primary font-semibold normal-case">/whatsapp</span>
          </nav>
          <div className="flex items-center gap-space-md flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Central de Atendimento WhatsApp</h1>
            <span className={`px-3 py-1 rounded-full font-label-md text-label-md flex items-center gap-2 ${selo.classe}`}>
              <span aria-hidden="true" className={`w-2 h-2 rounded-full ${selo.ponto}`} />
              {selo.texto}
              {latenciaMs !== null && <span className="opacity-70 font-normal">{latenciaMs}ms</span>}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-space-sm">
          {podeFiltrar && (
            <label className="flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md text-text-primary">
              Atendente
              <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} className="bg-transparent focus:outline-none">
                <option value="">Todos</option>
                {responsaveis.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-space-sm flex-wrap justify-end">
            <button
              type="button"
              onClick={() => void marcarTodas()}
              disabled={marcandoTodas || naoLidas === 0}
              className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md text-text-primary disabled:opacity-50 flex items-center gap-2"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[19px]">done_all</span>
              Marcar todas como lidas
            </button>
            <Link href="/whatsapp/nova" className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2">
              <span aria-hidden="true" className="material-symbols-outlined text-[19px]">add</span>
              Nova Conversa Externa
            </Link>
          </div>
        </div>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível carregar as conversas. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && dados === null && <EsqueletoCarregando />}
      {!erro && dados !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
            <CartaoKpi
              titulo="Conversas ativas hoje"
              icone="forum"
              corIcone="text-primary"
              valor={String(ativas)}
              destaque={ind && ind.novasHoje > 0 ? { texto: `+${ind.novasHoje} novas`, classe: 'bg-info-surface text-primary' } : null}
              barra={{ pct: total > 0 ? (ativas / total) * 100 : 0, classe: 'bg-primary' }}
            />
            <CartaoKpi
              titulo="Mensagens não lidas"
              icone="mark_chat_unread"
              corIcone="text-danger-text"
              valor={String(naoLidas)}
              destaque={naoLidas > 0 ? { texto: 'Urgente', classe: 'bg-danger-surface text-danger-text' } : null}
              legenda="Aguardando resposta imediata"
            />
            <CartaoKpi
              titulo="Tempo 1ª resposta"
              icone="timer"
              corIcone="text-success-text"
              valor={tempo !== null ? duracaoCurta(tempo) : '—'}
              destaque={{ texto: 'Meta < 5 min', classe: tempo === null || tempo < META_TEMPO_SEG ? 'bg-success-surface text-success-text' : 'bg-warning-surface text-warning-text' }}
              legenda={tempo === null ? 'Sem resposta enviada hoje' : 'Média das respostas de hoje'}
            />
            <CartaoKpi
              titulo="Taxa de resposta"
              icone="task_alt"
              corIcone="text-primary"
              valor={taxa !== null ? `${String(taxa).replace('.', ',')}%` : '—'}
              destaque={{ texto: `Meta ${META_TAXA}%`, classe: 'bg-surface-container text-text-primary' }}
              barra={{ pct: taxa ?? 0, classe: taxa !== null && taxa < META_TAXA ? 'bg-warning-text' : 'bg-success-text' }}
            />
          </div>

          {dados.contagens.todas === 0 && !busca && !responsavelId ? (
            <EstadoVazio titulo="Nenhuma conversa ainda" proximoPasso="inicie uma em Nova Conversa Externa, ou espere o primeiro contato de um lead" icone="chat" />
          ) : (
            // Lista | conversa | contexto do pipeline lado a lado (xl), todos com a mesma altura fixa.
            <div className="grid grid-cols-1 xl:grid-cols-[24rem_minmax(0,1fr)_21rem] gap-space-md xl:h-[36rem]">
            <ListaConversas
              conversas={dados.conversas}
              contagens={dados.contagens}
              aba={aba}
              busca={busca}
              selecionada={aberta?.chave ?? null}
              onAba={setAba}
              onBusca={setBusca}
              onEscolher={setSelecionada}
            />
            {aberta ? (
              <>
                <PainelConversa key={aberta.chave} conversa={aberta} versao={versao} onAtualizou={carregar} />
                <ContextoCard conversa={aberta} />
              </>
            ) : (
              <section className="xl:col-span-2 bg-surface-card rounded-2xl p-space-md shadow-sm min-h-[20rem] xl:h-full flex items-center justify-center">
                <EstadoVazio titulo="Escolha uma conversa" proximoPasso="clique em uma conversa da lista para ver o histórico e responder" icone="chat" />
              </section>
            )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

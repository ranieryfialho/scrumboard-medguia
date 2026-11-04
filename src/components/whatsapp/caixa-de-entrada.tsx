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

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { FaixaConexao, whatsappConectado, type StatusDoWhatsapp } from '@/components/pipeline/conversa/faixa-conexao';
import { EVENTO_CONTADORES_MUDARAM } from '@/components/shell/use-contadores';
import { saoNumerosEquivalentes, normalizarNumero } from '@/domain/whatsapp/numero';
import { ContextoCard } from './contexto-card';
import type { ConversaView, RespostaConversasView } from './comum';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { ListaConversas, type AbaConversas } from './lista-conversas';
import { PainelConversa } from './painel-conversa';

const INTERVALO_MS = 15_000;

function seloDaConexao(status: StatusDoWhatsapp | null): { texto: string; classe: string } {
  if (!status) return { texto: 'Verificando a conexão...', classe: 'bg-surface-container text-text-secondary' };
  if (whatsappConectado(status)) {
    return { texto: `Evolution API conectada${status.instance ? ` (${status.instance})` : ''}`, classe: 'bg-success-surface text-success-text' };
  }
  if (status.state === 'not_configured') return { texto: 'WhatsApp não configurado', classe: 'bg-warning-surface text-warning-text' };
  return { texto: 'Evolution API desconectada', classe: 'bg-danger-surface text-danger-text' };
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
    const lerStatus = () =>
      fetch('/api/whatsapp/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((s: StatusDoWhatsapp | null) => !cancelado && setStatus(s))
        .catch(() => undefined);
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

  return (
    <div className="p-space-md flex flex-col gap-space-md xl:h-[calc(100dvh-4rem)] xl:min-h-[44rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div className="flex items-center gap-space-md flex-wrap">
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Central de Atendimento WhatsApp</h1>
          <span className={`px-3 py-1 rounded-full font-label-md text-label-md ${selo.classe}`}>{selo.texto}</span>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
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
          <button
            type="button"
            onClick={() => void marcarTodas()}
            disabled={marcandoTodas || (dados?.resumo.naoLidas ?? 0) === 0}
            className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50"
          >
            Marcar todas como lidas
          </button>
          <Link href="/whatsapp/nova" className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[19px]">add</span>
            Nova Conversa Externa
          </Link>
        </div>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível carregar as conversas. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && dados === null && <EsqueletoCarregando />}
      {!erro && dados !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md shrink-0">
            <CartaoIndicador titulo="Conversas ativas hoje" valor={String(dados.resumo.ativasHoje)} legenda="com mensagem hoje" icone="forum" />
            <CartaoIndicador titulo="Mensagens não lidas" valor={String(dados.resumo.naoLidas)} legenda="Aguardando resposta" icone="mark_chat_unread" cor="danger" />
          </div>

          {dados.contagens.todas === 0 && !busca && !responsavelId ? (
            <EstadoVazio titulo="Nenhuma conversa ainda" proximoPasso="inicie uma em Nova Conversa Externa, ou espere o primeiro contato de um lead" icone="chat" />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)_20rem] gap-space-md xl:flex-1 xl:min-h-0">
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
                <PainelConversa key={aberta.chave} conversa={aberta} versao={versao} onAtualizou={carregar} />
              ) : (
                <section className="bg-surface-card rounded-2xl p-space-md shadow-sm xl:h-full flex items-center justify-center">
                  <EstadoVazio titulo="Escolha uma conversa" proximoPasso="clique em uma conversa da lista para ver o histórico e responder" icone="chat" />
                </section>
              )}
              <div className="flex flex-col gap-space-md xl:min-h-0 xl:overflow-y-auto">
                {aberta && <ContextoCard conversa={aberta} />}
                <FaixaConexao status={status} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

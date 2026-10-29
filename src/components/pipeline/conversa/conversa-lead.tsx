'use client';

// T-174 (fase4-card-abas, US-114, AC-437 a AC-442, AC-444): a conversa de
// WhatsApp do lead dentro do card — fonte visual
// `11._pipeline_id_conversa_whatsapp_do_lead/`. Usa as APIs que já existem:
// `GET /api/whatsapp/messages?leadId=`, `POST /api/whatsapp/send`,
// `POST /api/whatsapp/lidas`, `GET /api/whatsapp/status` e
// `GET /api/leads/[id]/telefones`. Mensagem nova do lead chega pelo evento
// `mensagem.recebida` do `/api/stream`. Itens sem backend (ligar, novo número,
// busca, menu, anexar, templates, respostas rápidas) ficam "em breve" (AC-444).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { EVENTO_CONTADORES_MUDARAM } from '@/components/shell/use-contadores';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { FaixaConexao, whatsappConectado, type StatusDoWhatsapp } from './faixa-conexao';
import {
  agruparPorDia,
  formatarHora,
  mensagemDoTelefone,
  statusDaMensagem,
  type MensagemDaConversa,
  type TelefoneDoLead,
} from './formatos';
import { SeletorTelefone } from './seletor-telefone';

/** AC-439: o motivo de cada recusa do envio, sem perder o texto digitado. */
const MENSAGENS_DE_ERRO: Record<string, string> = {
  WHATSAPP_NAO_CONFIGURADO: 'O WhatsApp da empresa não está configurado.',
  NUMERO_SEM_WHATSAPP: 'Este número não tem WhatsApp.',
  FALHA_ENVIO: 'Falha no envio. Tente de novo.',
  LEAD_SEM_TELEFONE: 'Este lead não tem telefone cadastrado.',
};

/** AC-442: escuta `mensagem.recebida` do stream e avisa só quando a mensagem é deste lead. */
function useMensagemRecebida(leadId: string, aoChegar: () => void) {
  const aoChegarRef = useRef(aoChegar);
  useEffect(() => {
    aoChegarRef.current = aoChegar;
  }, [aoChegar]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const origem = new EventSource('/api/stream');
    origem.addEventListener('mensagem.recebida', (evento) => {
      try {
        const dados = JSON.parse((evento as MessageEvent).data) as { leadId?: string | null };
        if (dados.leadId === leadId) aoChegarRef.current();
      } catch {
        // Evento malformado: ignora, a próxima abertura da conversa relê o histórico.
      }
    });
    return () => origem.close();
  }, [leadId]);
}

interface ConversaLeadProps {
  leadId: string;
}

export function ConversaLead({ leadId }: ConversaLeadProps) {
  const [mensagens, setMensagens] = useState<MensagemDaConversa[] | null>(null);
  const [telefones, setTelefones] = useState<TelefoneDoLead[]>([]);
  const [escolhido, setEscolhido] = useState(0);
  const [status, setStatus] = useState<StatusDoWhatsapp | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroDeEnvio, setErroDeEnvio] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);

  /** AC-440: as recebidas viram lidas e o menu lateral relê o contador. */
  const marcarComoLidas = useCallback(async () => {
    try {
      const resposta = await fetch('/api/whatsapp/lidas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });
      if (resposta.ok) window.dispatchEvent(new Event(EVENTO_CONTADORES_MUDARAM));
    } catch {
      // Sem conectividade: as mensagens seguem não lidas até a próxima abertura.
    }
  }, [leadId]);

  const carregarMensagens = useCallback(async () => {
    setErro(false);
    try {
      const resposta = await fetch(`/api/whatsapp/messages?leadId=${leadId}`);
      if (!resposta.ok) throw new Error(`mensagens respondeu ${resposta.status}`);
      const corpo = (await resposta.json()) as { mensagens: MensagemDaConversa[] };
      setMensagens(corpo.mensagens);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, [leadId]);

  useEffect(() => {
    void carregarMensagens().then(() => marcarComoLidas());
  }, [carregarMensagens, marcarComoLidas]);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/leads/${leadId}/telefones`)
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: { telefones?: TelefoneDoLead[] } | null) => {
        if (!cancelado) setTelefones(corpo?.telefones ?? []);
      })
      .catch(() => undefined);
    fetch('/api/whatsapp/status')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: StatusDoWhatsapp | null) => {
        if (!cancelado) setStatus(corpo);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [leadId]);

  useMensagemRecebida(
    leadId,
    useCallback(() => {
      void carregarMensagens().then(() => marcarComoLidas());
    }, [carregarMensagens, marcarComoLidas])
  );

  const telefone = telefones[escolhido] ?? null;

  // Com mais de um telefone, a conversa mostra só o número escolhido (AC-438).
  const visiveis = useMemo(() => {
    if (!mensagens) return [];
    if (telefones.length <= 1 || !telefone) return mensagens;
    return mensagens.filter((mensagem) => mensagemDoTelefone(mensagem, telefone));
  }, [mensagens, telefones, telefone]);

  const grupos = useMemo(() => agruparPorDia(visiveis), [visiveis]);

  // AC-437: a conversa abre rolada até a mensagem mais recente.
  useEffect(() => {
    fimRef.current?.scrollIntoView?.({ block: 'end' });
  }, [visiveis.length]);

  const podeEnviar = whatsappConectado(status) && !enviando;

  async function enviar() {
    const mensagem = texto.trim();
    if (!mensagem || !podeEnviar) return;
    setEnviando(true);
    setErroDeEnvio(null);
    try {
      const resposta = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mensagem, leadId, ...(telefone?.id ? { telefoneId: telefone.id } : {}) }),
      });
      if (resposta.ok) {
        setTexto('');
        await carregarMensagens();
        return;
      }
      const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
      setErroDeEnvio(MENSAGENS_DE_ERRO[corpo?.codigo ?? ''] ?? 'Não foi possível enviar a mensagem. Tente de novo.');
    } catch {
      setErroDeEnvio('Não foi possível enviar a mensagem. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      void enviar();
    }
  }

  return (
    <section aria-label="Conversa do WhatsApp" className="bg-surface-card rounded-2xl shadow-sm flex flex-col min-h-[32rem]">
      <div className="p-space-md border-b border-border-subtle flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center gap-space-sm">
          <SeletorTelefone telefones={telefones} escolhido={escolhido} onEscolher={setEscolhido} />
          <ItemEmBreve rotulo="Novo Número" icone="add_call" className="h-10 px-3 rounded-xl bg-surface-subtle" />
          <ItemEmBreve rotulo="Buscar na conversa" icone="search" className="h-10 px-3 rounded-xl bg-surface-subtle" />
          <ItemEmBreve rotulo="Mais opções" icone="more_vert" className="h-10 px-3 rounded-xl bg-surface-subtle" />
        </div>
        <FaixaConexao status={status} />
      </div>

      <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-sm bg-surface-subtle/40">
        {carregando && <EsqueletoCarregando />}
        {!carregando && erro && <EstadoErro onTentarDeNovo={carregarMensagens} />}
        {!carregando && !erro && visiveis.length === 0 && (
          <EstadoVazio titulo="Nenhuma mensagem ainda" proximoPasso="escreva a primeira abaixo" icone="chat" />
        )}
        {!carregando &&
          !erro &&
          grupos.map((grupo) => (
            <div key={grupo.rotulo} className="flex flex-col gap-space-sm">
              <p className="self-center font-label-sm text-label-sm text-primary uppercase tracking-wider font-bold">{grupo.rotulo}</p>
              {grupo.mensagens.map((mensagem) => {
                const enviada = mensagem.direcao === 'enviada';
                return (
                  <div key={mensagem.id} className={`flex ${enviada ? 'justify-end' : 'justify-start'}`}>
                    <div
                      data-direcao={mensagem.direcao}
                      className={`max-w-[80%] rounded-2xl px-space-md py-space-sm shadow-sm ${
                        enviada ? 'bg-primary text-on-primary' : 'bg-surface-card text-text-primary'
                      }`}
                    >
                      <p className="font-body-md text-body-md whitespace-pre-wrap break-words">{mensagem.mensagem}</p>
                      <p className={`mt-1 text-right font-label-sm text-[11px] ${enviada ? 'opacity-80' : 'text-text-muted'}`}>
                        {formatarHora(mensagem.created_at)}
                        {enviada ? ` · ${statusDaMensagem(mensagem.status)}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        <div ref={fimRef} />
      </div>

      <div className="p-space-md border-t border-border-subtle flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ItemEmBreve rotulo="Respostas rápidas" icone="bolt" className="h-9 px-2 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Anexar arquivo" icone="attach_file" className="h-9 px-2 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Templates" icone="chat_paste_go" className="h-9 px-2 rounded-lg bg-surface-subtle" />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            onKeyDown={aoTeclar}
            disabled={!whatsappConectado(status)}
            rows={3}
            placeholder="Digite uma mensagem..."
            aria-label="Mensagem para o lead"
            className="flex-1 min-h-[84px] resize-y rounded-xl border border-border-subtle bg-surface-card px-3 py-2 font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!podeEnviar || texto.trim() === ''}
            aria-label="Enviar mensagem"
            className="h-12 w-12 shrink-0 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-md disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              send
            </span>
          </button>
        </div>
        {!whatsappConectado(status) && status && (
          <p className="font-body-sm text-body-sm text-text-muted">O envio fica desabilitado enquanto o WhatsApp não estiver conectado.</p>
        )}
        {erroDeEnvio && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
            {erroDeEnvio}
          </p>
        )}
        <p className="font-body-sm text-[11px] text-text-muted text-right">
          Pressione <strong>Enter</strong> para enviar
        </p>
      </div>
    </section>
  );
}

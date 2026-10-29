'use client';

// T-190 (fase4-whatsapp, AC-503/AC-504/AC-509): o painel da conversa aberta —
// histórico, marcar como lida e responder. Usa as APIs que já existem
// (`GET /api/whatsapp/messages`, `POST /api/whatsapp/lidas`, `POST /api/whatsapp/send`).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';

import { agruparPorDia, formatarHora, statusDaMensagem, type MensagemDaConversa } from '@/components/pipeline/conversa/formatos';
import { EVENTO_CONTADORES_MUDARAM } from '@/components/shell/use-contadores';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from './estados';
import { formatarNumero, iniciais, mensagemDeErroDoEnvio, MENSAGEM_ERRO_PADRAO_DO_ENVIO, nomeDaConversa, type ConversaView } from './comum';

interface PainelConversaProps {
  conversa: Pick<ConversaView, 'leadId' | 'numero' | 'nome' | 'naoLidas' | 'card'>;
  /** Muda a cada releitura automática da caixa (AC-508). */
  versao: number;
  /** Chamado depois de enviar ou marcar como lida, para a lista reler. */
  onAtualizou: () => void;
}

export function PainelConversa({ conversa, versao, onAtualizou }: PainelConversaProps) {
  const [mensagens, setMensagens] = useState<MensagemDaConversa[] | null>(null);
  const [erro, setErro] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroDeEnvio, setErroDeEnvio] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement | null>(null);

  const consulta = conversa.leadId ? `leadId=${conversa.leadId}` : `numero=${conversa.numero}`;
  const alvo = useMemo(() => (conversa.leadId ? { leadId: conversa.leadId } : { numero: conversa.numero }), [conversa.leadId, conversa.numero]);

  const marcarComoLida = useCallback(async () => {
    try {
      const r = await fetch('/api/whatsapp/lidas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(alvo) });
      if (r.ok) {
        window.dispatchEvent(new Event(EVENTO_CONTADORES_MUDARAM));
        onAtualizou();
      }
    } catch {
      // Sem conectividade: segue não lida até a próxima abertura.
    }
  }, [alvo, onAtualizou]);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/whatsapp/messages?${consulta}`);
      if (!r.ok) throw new Error(`mensagens respondeu ${r.status}`);
      setMensagens(((await r.json()) as { mensagens: MensagemDaConversa[] }).mensagens);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, [consulta]);

  // AC-503: ao abrir (e a cada releitura), lê o histórico; se há não lidas, marca como lida.
  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  useEffect(() => {
    if (conversa.naoLidas > 0) void marcarComoLida();
  }, [conversa.naoLidas, marcarComoLida]);

  const grupos = useMemo(() => agruparPorDia(mensagens ?? []), [mensagens]);
  useEffect(() => {
    fimRef.current?.scrollIntoView?.({ block: 'end' });
  }, [mensagens?.length]);

  async function enviar() {
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setEnviando(true);
    setErroDeEnvio(null);
    try {
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mensagem, ...alvo }),
      });
      if (r.ok) {
        setTexto('');
        await carregar();
        onAtualizou();
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
      setErroDeEnvio(mensagemDeErroDoEnvio(corpo?.codigo));
    } catch {
      setErroDeEnvio(MENSAGEM_ERRO_PADRAO_DO_ENVIO);
    } finally {
      setEnviando(false);
    }
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  }

  const nome = nomeDaConversa(conversa);
  return (
    <section aria-label="Conversa aberta" className="bg-surface-card rounded-2xl shadow-sm flex flex-col min-h-[32rem]">
      <div className="p-space-md border-b border-border-subtle flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden="true" className="w-11 h-11 rounded-full bg-surface-container flex items-center justify-center font-label-lg text-label-lg text-text-secondary">
            {iniciais(nome)}
          </span>
          <div className="min-w-0">
            <h2 className="font-headline-sm text-headline-sm text-text-primary truncate">{nome}</h2>
            <p className="font-body-sm text-body-sm text-text-muted">{formatarNumero(conversa.numero)}</p>
          </div>
        </div>
        {conversa.card && (
          <Link href={`/pipeline/${conversa.card.id}`} className="h-9 px-3 rounded-lg bg-surface-subtle text-text-primary font-label-md text-label-md flex items-center hover:bg-surface-container">
            Abrir card
          </Link>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-sm bg-surface-subtle/40">
        {mensagens === null && !erro && <EsqueletoCarregando />}
        {erro && <EstadoErro onTentarDeNovo={carregar} />}
        {!erro && mensagens !== null && mensagens.length === 0 && <EstadoVazio titulo="Nenhuma mensagem ainda" proximoPasso="escreva a primeira abaixo" icone="chat" />}
        {!erro &&
          grupos.map((g) => (
            <div key={g.rotulo} className="flex flex-col gap-space-sm">
              <p className="self-center font-label-sm text-label-sm text-primary uppercase tracking-wider font-bold">{g.rotulo}</p>
              {g.mensagens.map((m) => {
                const enviada = m.direcao === 'enviada';
                return (
                  <div key={m.id} className={`flex ${enviada ? 'justify-end' : 'justify-start'}`}>
                    <div data-direcao={m.direcao} className={`max-w-[80%] rounded-2xl px-space-md py-space-sm shadow-sm ${enviada ? 'bg-primary text-on-primary' : 'bg-surface-card text-text-primary'}`}>
                      <p className="font-body-md text-body-md whitespace-pre-wrap break-words">{m.mensagem}</p>
                      <p className={`mt-1 text-right font-label-sm text-[11px] ${enviada ? 'opacity-80' : 'text-text-muted'}`}>
                        {formatarHora(m.created_at)}
                        {enviada ? ` · ${statusDaMensagem(m.status)}` : ''}
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
        <div className="flex items-center gap-2 flex-wrap">
          <ItemEmBreve rotulo="Respostas rápidas" icone="bolt" className="h-9 px-2 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Anexar arquivo" icone="attach_file" className="h-9 px-2 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Emoji" icone="mood" className="h-9 px-2 rounded-lg bg-surface-subtle" />
          <ItemEmBreve rotulo="Microfone" icone="mic" className="h-9 px-2 rounded-lg bg-surface-subtle" />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={aoTeclar}
            rows={3}
            placeholder={`Digite uma mensagem para ${nome} (Enter para enviar)`}
            aria-label="Mensagem"
            className="flex-1 min-h-[84px] resize-y rounded-xl border border-border-subtle bg-surface-card px-3 py-2 font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || texto.trim() === ''}
            className="h-12 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-md disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
        {erroDeEnvio && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
            {erroDeEnvio}
          </p>
        )}
        <p className="font-body-sm text-[11px] text-text-muted text-right">
          Pressione <strong>Enter</strong> para enviar e <strong>Shift + Enter</strong> para quebra de linha
        </p>
      </div>
    </section>
  );
}

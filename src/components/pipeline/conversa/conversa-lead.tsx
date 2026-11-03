'use client';

// T-174 (fase4-card-abas, US-114, AC-437 a AC-442): a conversa de
// WhatsApp do lead dentro do card — fonte visual
// `11._pipeline_id_conversa_whatsapp_do_lead/`. Usa as APIs que já existem:
// `GET /api/whatsapp/messages?leadId=`, `POST /api/whatsapp/send`,
// `POST /api/whatsapp/lidas`, `GET /api/whatsapp/status` e
// `GET /api/leads/[id]/telefones`. Mensagem nova do lead chega pelo evento
// `mensagem.recebida` do `/api/stream`. Itens sem backend (ligar, novo número,
// busca, menu, anexar, templates, respostas rápidas) ficavam "em breve" (AC-444); em T-288 (AC-740/AC-741) viraram
// reais; em T-290 (AC-744 a AC-747) entraram o áudio (gravar e ouvir) e o anexo de arquivos.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { EVENTO_CONTADORES_MUDARAM } from '@/components/shell/use-contadores';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';
import { ehMarcadorDeMidia, LIMITE_MIDIA_BYTES } from '@/domain/whatsapp/midia';
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
import { ModalNovoNumero } from './modal-novo-numero';
import { MenuOpcoes } from './menu-opcoes';
import { GravadorAudio } from './gravador-audio';
import { MidiaDaMensagem } from './midia-da-mensagem';
import { RespostasETemplates } from './respostas-e-templates';

/** Para a busca: minúsculas e sem acento, assim "clinica" acha "Clínica". */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** AC-439: o motivo de cada recusa do envio, sem perder o texto digitado. */
const MENSAGENS_DE_ERRO: Record<string, string> = {
  WHATSAPP_NAO_CONFIGURADO: 'O WhatsApp da empresa não está configurado.',
  NUMERO_SEM_WHATSAPP: 'Este número não tem WhatsApp.',
  FALHA_ENVIO: 'Falha no envio. Tente de novo.',
  LEAD_SEM_TELEFONE: 'Este lead não tem telefone cadastrado.',
  ARQUIVO_GRANDE: 'O arquivo passa de 16 MB.',
  TIPO_NAO_PERMITIDO: 'Este tipo de arquivo não pode ser enviado. Use imagem, vídeo, PDF, Office, texto ou áudio.',
};

function tamanhoLegivel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
  /** Nome do lead, para preencher {{nome}} e {{primeiro_nome}} dos templates. */
  leadNome?: string;
}

export function ConversaLead({ leadId, leadNome = '' }: ConversaLeadProps) {
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
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [busca, setBusca] = useState('');
  const [novoNumeroAberto, setNovoNumeroAberto] = useState(false);
  const [anexo, setAnexo] = useState<File | null>(null);
  const [avisoDoGravador, setAvisoDoGravador] = useState<string | null>(null);
  const seletorDeArquivo = useRef<HTMLInputElement | null>(null);

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

  const carregarTelefones = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/leads/${leadId}/telefones`);
      const corpo = resposta.ok ? ((await resposta.json()) as { telefones?: TelefoneDoLead[] }) : null;
      setTelefones(corpo?.telefones ?? []);
    } catch {
      // Sem conectividade: mantém a lista como estava.
    }
  }, [leadId]);

  useEffect(() => {
    void carregarTelefones();
  }, [carregarTelefones]);

  useEffect(() => {
    let cancelado = false;
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

  // AC-740: a busca filtra as mensagens já carregadas, sem acento e sem diferenciar maiúsculas.
  const encontradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return termo ? visiveis.filter((mensagem) => semAcento(mensagem.mensagem).includes(termo)) : visiveis;
  }, [visiveis, busca]);

  const grupos = useMemo(() => agruparPorDia(encontradas), [encontradas]);

  // AC-437: a conversa abre rolada até a mensagem mais recente.
  useEffect(() => {
    fimRef.current?.scrollIntoView?.({ block: 'end' });
  }, [visiveis.length]);

  const podeEnviar = whatsappConectado(status) && !enviando;

  /** AC-744/AC-746: envia o áudio gravado ou o arquivo anexado (com o texto do campo como legenda) por `POST /api/whatsapp/send-midia`. */
  async function enviarMidia(arquivo: File, modo: 'audio' | 'arquivo') {
    if (!podeEnviar) return;
    setEnviando(true);
    setErroDeEnvio(null);
    try {
      const formulario = new FormData();
      formulario.set('arquivo', arquivo);
      formulario.set('modo', modo);
      formulario.set('leadId', leadId);
      if (telefone?.id) formulario.set('telefoneId', telefone.id);
      if (modo === 'arquivo' && texto.trim()) formulario.set('legenda', texto.trim());
      const resposta = await fetch('/api/whatsapp/send-midia', { method: 'POST', body: formulario });
      if (resposta.ok) {
        if (modo === 'arquivo') {
          setAnexo(null);
          setTexto('');
        }
        await carregarMensagens();
        return;
      }
      const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
      setErroDeEnvio(MENSAGENS_DE_ERRO[corpo?.codigo ?? ''] ?? 'Não foi possível enviar. Tente de novo.');
    } catch {
      setErroDeEnvio('Não foi possível enviar. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > LIMITE_MIDIA_BYTES) {
      setErroDeEnvio(MENSAGENS_DE_ERRO.ARQUIVO_GRANDE);
      return;
    }
    setErroDeEnvio(null);
    setAnexo(arquivo);
  }

  async function enviar() {
    if (anexo) {
      await enviarMidia(anexo, 'arquivo');
      return;
    }
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
          <button
            type="button"
            onClick={() => setNovoNumeroAberto(true)}
            className="h-10 px-3 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md text-text-primary flex items-center gap-2"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              add_call
            </span>
            Novo Número
          </button>
          <button
            type="button"
            aria-label="Buscar na conversa"
            aria-pressed={buscaAberta}
            onClick={() => {
              setBuscaAberta((aberta) => !aberta);
              setBusca('');
            }}
            className="h-10 w-10 rounded-xl bg-surface-subtle hover:bg-surface-container flex items-center justify-center"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              search
            </span>
          </button>
          <MenuOpcoes
            numero={telefone?.numero ?? null}
            onAtualizar={() => void carregarMensagens()}
            onMarcarLidas={() => void marcarComoLidas()}
          />
        </div>
        {buscaAberta && (
          <div className="flex items-center gap-2">
            <input
              type="search"
              autoFocus
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar nas mensagens…"
              aria-label="Buscar nas mensagens"
              className="flex-1 h-10 px-3 bg-surface-subtle rounded-xl font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {busca.trim() !== '' && (
              <span role="status" className="font-body-sm text-body-sm text-text-secondary whitespace-nowrap">
                {encontradas.length === 1 ? '1 mensagem' : `${encontradas.length} mensagens`}
              </span>
            )}
          </div>
        )}
        <FaixaConexao status={status} />
      </div>

      <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-sm bg-surface-subtle/40">
        {carregando && <EsqueletoCarregando />}
        {!carregando && erro && <EstadoErro onTentarDeNovo={carregarMensagens} />}
        {!carregando && !erro && visiveis.length === 0 && (
          <EstadoVazio titulo="Nenhuma mensagem ainda" proximoPasso="escreva a primeira abaixo" icone="chat" />
        )}
        {!carregando && !erro && visiveis.length > 0 && encontradas.length === 0 && (
          <EstadoVazio titulo="Nenhuma mensagem encontrada" proximoPasso="tente outra palavra" icone="search_off" />
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
                      {mensagem.midia && <MidiaDaMensagem mensagemId={mensagem.id} midia={mensagem.midia} />}
                      {(!mensagem.midia || (!ehMarcadorDeMidia(mensagem.mensagem) && mensagem.mensagem !== mensagem.midia.nome)) && (
                        <p className="font-body-md text-body-md whitespace-pre-wrap break-words">{mensagem.mensagem}</p>
                      )}
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
          <RespostasETemplates leadNome={leadNome} onEscolher={(preenchido) => setTexto((atual) => (atual.trim() ? `${atual}\n${preenchido}` : preenchido))} />
        </div>
        {anexo && (
          <div className="flex items-center gap-2 rounded-lg bg-surface-subtle px-3 py-2 font-body-md text-body-md text-text-primary" data-testid="anexo-escolhido">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-primary">
              attach_file
            </span>
            <span className="truncate font-semibold">{anexo.name}</span>
            <span className="text-text-muted whitespace-nowrap">{tamanhoLegivel(anexo.size)}</span>
            <button type="button" onClick={() => setAnexo(null)} aria-label="Remover anexo" className="ml-auto h-7 w-7 rounded-lg hover:bg-surface-container flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                close
              </span>
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={seletorDeArquivo}
            type="file"
            hidden
            aria-label="Arquivo para anexar"
            onChange={(evento) => {
              escolherArquivo(evento.target.files?.[0]);
              evento.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => seletorDeArquivo.current?.click()}
            disabled={!whatsappConectado(status) || enviando}
            aria-label="Anexar arquivo"
            title="Anexar arquivo"
            className="h-12 w-12 shrink-0 rounded-xl bg-surface-subtle hover:bg-surface-container flex items-center justify-center text-text-primary disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              attach_file
            </span>
          </button>
          <textarea
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            onKeyDown={aoTeclar}
            disabled={!whatsappConectado(status)}
            rows={3}
            placeholder={anexo ? 'Legenda (opcional)…' : 'Digite uma mensagem...'}
            aria-label="Mensagem para o lead"
            className="flex-1 min-h-[84px] resize-y rounded-xl border border-border-subtle bg-surface-card px-3 py-2 font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!podeEnviar || (texto.trim() === '' && !anexo)}
            aria-label="Enviar mensagem"
            className="h-12 w-12 shrink-0 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-md disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              send
            </span>
          </button>
          {texto.trim() === '' && !anexo && (
            <GravadorAudio desabilitado={!podeEnviar} onEnviar={(audio) => enviarMidia(audio, 'audio')} onAviso={setAvisoDoGravador} />
          )}
        </div>
        {avisoDoGravador && (
          <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
            {avisoDoGravador}
          </p>
        )}
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
      {novoNumeroAberto && (
        <ModalNovoNumero
          leadId={leadId}
          onFechar={() => setNovoNumeroAberto(false)}
          onSalvo={() => {
            setNovoNumeroAberto(false);
            void carregarTelefones();
          }}
        />
      )}
    </section>
  );
}

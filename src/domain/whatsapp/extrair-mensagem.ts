// T-067 (fase2c-whatsapp-entrada, US-040, AC-122/AC-123): extrai, de forma
// pura e sem I/O, as mensagens recebidas de um payload de webhook da
// Evolution API. Porta a lógica do webhook legado (src/app/api/whatsapp/
// webhook/route.ts) para fora da rota, sem Supabase, para ser reaproveitada
// pelo repositório (T-068) e pela rota nova (T-069).

import { eventoDeAtualizacao } from './extrair-status';

interface EvolutionMessageKey {
  fromMe?: boolean;
  remoteJid?: string;
  remoteJidAlt?: string;
  id?: string;
}

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string; mimetype?: string };
  videoMessage?: { caption?: string; mimetype?: string };
  documentMessage?: { caption?: string; mimetype?: string; fileName?: string };
  audioMessage?: { mimetype?: string } | unknown;
  stickerMessage?: { mimetype?: string } | unknown;
}

interface EvolutionMessageItem extends EvolutionMessageContent {
  key?: EvolutionMessageKey;
  message?: EvolutionMessageContent;
}

export interface EvolutionWebhookPayload {
  event?: string;
  data?: EvolutionMessageItem | EvolutionMessageItem[];
}

/** T-290 (AC-745): a mídia que veio na mensagem — o arquivo em si só é buscado na Evolution quando alguém abre. */
export interface MidiaExtraida {
  tipo: 'audio' | 'imagem' | 'video' | 'documento' | 'figurinha';
  mimetype: string | null;
  nome: string | null;
}

export interface MensagemExtraida {
  numero: string;
  texto: string;
  evolutionMessageId: string | null;
  /** Só existe quando a mensagem tem mídia; mensagem de texto não leva a chave. */
  midia?: MidiaExtraida;
}

/** @spec:AC-123 só processa eventos de mensagem (ex.: `messages.upsert`). */
export function eventoDeMensagem(event: string | undefined): boolean {
  return (event ?? '').toLowerCase().includes('messages');
}

function normalizarNumero(item: EvolutionMessageItem): string {
  // Prioriza remoteJidAlt (número real) sobre remoteJid (pode ser ID de device).
  const remoteJid = item.key?.remoteJidAlt || item.key?.remoteJid || '';
  if (remoteJid.includes('@g.us')) return '';
  return remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function extrairTexto(item: EvolutionMessageItem): string {
  const msgData = item.message ?? item;
  return (
    msgData.conversation ||
    msgData.extendedTextMessage?.text ||
    msgData.imageMessage?.caption ||
    msgData.videoMessage?.caption ||
    msgData.documentMessage?.caption ||
    (msgData.audioMessage ? '[áudio]' : null) ||
    (msgData.stickerMessage ? '[figurinha]' : null) ||
    '[mídia]'
  );
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function extrairMidia(item: EvolutionMessageItem): MidiaExtraida | null {
  const msgData = item.message ?? item;
  const mimetypeDe = (conteudo: unknown) => texto((conteudo as { mimetype?: unknown } | null)?.mimetype);
  if (msgData.audioMessage) return { tipo: 'audio', mimetype: mimetypeDe(msgData.audioMessage), nome: null };
  if (msgData.imageMessage) return { tipo: 'imagem', mimetype: mimetypeDe(msgData.imageMessage), nome: null };
  if (msgData.videoMessage) return { tipo: 'video', mimetype: mimetypeDe(msgData.videoMessage), nome: null };
  if (msgData.documentMessage) {
    return { tipo: 'documento', mimetype: mimetypeDe(msgData.documentMessage), nome: texto(msgData.documentMessage.fileName) };
  }
  if (msgData.stickerMessage) return { tipo: 'figurinha', mimetype: mimetypeDe(msgData.stickerMessage), nome: null };
  return null;
}

/**
 * @spec:AC-122 @spec:AC-123
 * Extrai as mensagens recebidas válidas de um payload de webhook da
 * Evolution API. Aceita `data` como item único ou array. Descarta: eventos
 * que não são de mensagem, itens com `fromMe = true`, de grupo (`@g.us`) ou
 * sem número extraível.
 */
export function extrairMensagens(payload: EvolutionWebhookPayload): MensagemExtraida[] {
  // `messages.update` é aviso de status (check/lida), não mensagem nova — quem trata é `extrair-status.ts`.
  if (!eventoDeMensagem(payload.event) || eventoDeAtualizacao(payload.event)) return [];

  const dataItems: EvolutionMessageItem[] = Array.isArray(payload.data)
    ? payload.data
    : payload.data
      ? [payload.data]
      : [];

  const mensagens: MensagemExtraida[] = [];
  for (const item of dataItems) {
    if (item.key?.fromMe) continue;

    const numero = normalizarNumero(item);
    if (!numero) continue;

    const midia = extrairMidia(item);
    mensagens.push({
      numero,
      texto: extrairTexto(item),
      evolutionMessageId: item.key?.id ?? null,
      ...(midia ? { midia } : {}),
    });
  }
  return mensagens;
}

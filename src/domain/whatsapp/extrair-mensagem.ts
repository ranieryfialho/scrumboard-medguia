// T-067 (fase2c-whatsapp-entrada, US-040, AC-122/AC-123): extrai, de forma
// pura e sem I/O, as mensagens recebidas de um payload de webhook da
// Evolution API. Porta a lógica do webhook legado (src/app/api/whatsapp/
// webhook/route.ts) para fora da rota, sem Supabase, para ser reaproveitada
// pelo repositório (T-068) e pela rota nova (T-069).

interface EvolutionMessageKey {
  fromMe?: boolean;
  remoteJid?: string;
  remoteJidAlt?: string;
  id?: string;
}

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  documentMessage?: { caption?: string };
  audioMessage?: unknown;
  stickerMessage?: unknown;
}

interface EvolutionMessageItem extends EvolutionMessageContent {
  key?: EvolutionMessageKey;
  message?: EvolutionMessageContent;
}

export interface EvolutionWebhookPayload {
  event?: string;
  data?: EvolutionMessageItem | EvolutionMessageItem[];
}

export interface MensagemExtraida {
  numero: string;
  texto: string;
  evolutionMessageId: string | null;
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

/**
 * @spec:AC-122 @spec:AC-123
 * Extrai as mensagens recebidas válidas de um payload de webhook da
 * Evolution API. Aceita `data` como item único ou array. Descarta: eventos
 * que não são de mensagem, itens com `fromMe = true`, de grupo (`@g.us`) ou
 * sem número extraível.
 */
export function extrairMensagens(payload: EvolutionWebhookPayload): MensagemExtraida[] {
  if (!eventoDeMensagem(payload.event)) return [];

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

    mensagens.push({
      numero,
      texto: extrairTexto(item),
      evolutionMessageId: item.key?.id ?? null,
    });
  }
  return mensagens;
}

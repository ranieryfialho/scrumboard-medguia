// Atualização de status de uma mensagem que NÓS enviamos (evento `messages.update` da Evolution): um check (enviada ao servidor do
// WhatsApp), dois checks (entregue no aparelho) e dois checks azuis (lida). Pura e sem I/O, no mesmo molde de `extrair-mensagem.ts`.

export type StatusDaMensagemGravado = 'enviada' | 'entregue' | 'lida';

interface ItemDeAtualizacao {
  /** Evolution v2: id da mensagem no WhatsApp (o mesmo que `key.id` devolvido no envio). */
  keyId?: string;
  key?: { id?: string; fromMe?: boolean };
  /** Evolution v2: texto (`DELIVERY_ACK`, `READ`...). */
  status?: string | number;
  /** Formato cru do Baileys: `update.status` numérico ou texto. */
  update?: { status?: string | number };
}

export interface PayloadDeAtualizacao {
  event?: string;
  data?: ItemDeAtualizacao | ItemDeAtualizacao[];
}

export interface AtualizacaoDeStatus {
  evolutionMessageId: string;
  status: StatusDaMensagemGravado;
}

/** `messages.update` / `MESSAGES_UPDATE` (a Evolution manda os dois jeitos de escrever). */
export function eventoDeAtualizacao(event: string | undefined): boolean {
  const limpo = (event ?? '').toLowerCase().replace(/_/g, '.');
  return limpo.includes('messages') && limpo.includes('update');
}

// Baileys: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
const POR_NOME: Record<string, StatusDaMensagemGravado> = {
  PENDING: 'enviada',
  SERVER_ACK: 'enviada',
  DELIVERY_ACK: 'entregue',
  DELIVERED: 'entregue',
  READ: 'lida',
  PLAYED: 'lida',
};
const POR_NUMERO: Record<number, StatusDaMensagemGravado> = { 1: 'enviada', 2: 'enviada', 3: 'entregue', 4: 'lida', 5: 'lida' };

function traduzir(bruto: string | number | undefined): StatusDaMensagemGravado | null {
  if (typeof bruto === 'number') return POR_NUMERO[bruto] ?? null;
  if (typeof bruto !== 'string') return null;
  const limpo = bruto.trim().toUpperCase();
  return POR_NOME[limpo] ?? (/^\d+$/.test(limpo) ? (POR_NUMERO[Number(limpo)] ?? null) : null);
}

/** Atualizações válidas do payload; ignora itens sem id da mensagem ou com status que não muda nada (erro, desconhecido). */
export function extrairAtualizacoesDeStatus(payload: PayloadDeAtualizacao): AtualizacaoDeStatus[] {
  if (!eventoDeAtualizacao(payload.event)) return [];

  const itens = Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
  const resultado: AtualizacaoDeStatus[] = [];
  for (const item of itens) {
    const evolutionMessageId = item.keyId ?? item.key?.id;
    const status = traduzir(item.update?.status ?? item.status);
    if (!evolutionMessageId || !status) continue;
    resultado.push({ evolutionMessageId, status });
  }
  return resultado;
}

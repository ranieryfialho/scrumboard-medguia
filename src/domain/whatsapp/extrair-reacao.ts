// Reação a uma mensagem (o emoji embaixo do balão), vinda no evento `messages.upsert` da Evolution como `message.reactionMessage`.
// Pura e sem I/O, no mesmo molde de `extrair-mensagem.ts` e `extrair-status.ts`.

interface ItemComReacao {
  /** Quem reagiu: `fromMe = true` é a empresa (por exemplo, pelo celular), `false` é o contato. */
  key?: { fromMe?: boolean; remoteJid?: string; remoteJidAlt?: string; id?: string };
  message?: ConteudoComReacao;
  reactionMessage?: ReacaoCrua;
}

interface ConteudoComReacao {
  reactionMessage?: ReacaoCrua;
}

interface ReacaoCrua {
  /** A mensagem que recebeu a reação. */
  key?: { id?: string };
  /** O emoji; texto vazio = a pessoa tirou a reação. */
  text?: string;
}

export interface PayloadComReacoes {
  event?: string;
  data?: ItemComReacao | ItemComReacao[];
}

export interface ReacaoExtraida {
  /** `key.id` (na Evolution) da mensagem que recebeu a reação. */
  evolutionMessageId: string;
  autor: 'nos' | 'contato';
  /** Vazio = reação removida. */
  emoji: string;
}

function itensDoPayload(payload: PayloadComReacoes): ItemComReacao[] {
  return Array.isArray(payload.data) ? payload.data : payload.data ? [payload.data] : [];
}

/** O item é uma reação (e não uma mensagem de verdade)? */
export function ehReacao(item: { message?: { reactionMessage?: unknown }; reactionMessage?: unknown }): boolean {
  return Boolean((item.message ?? item).reactionMessage);
}

/** Reações válidas do payload; ignora eventos de atualização de status e itens sem a mensagem de destino. */
export function extrairReacoes(payload: PayloadComReacoes): ReacaoExtraida[] {
  const evento = (payload.event ?? '').toLowerCase();
  if (!evento.includes('messages') || evento.includes('update')) return [];

  const reacoes: ReacaoExtraida[] = [];
  for (const item of itensDoPayload(payload)) {
    const crua = (item.message ?? item).reactionMessage;
    const evolutionMessageId = crua?.key?.id;
    if (!crua || !evolutionMessageId) continue;
    reacoes.push({
      evolutionMessageId,
      autor: item.key?.fromMe ? 'nos' : 'contato',
      emoji: (crua.text ?? '').trim(),
    });
  }
  return reacoes;
}

// T-174 (fase4-card-abas, US-114): formatação e agrupamento das mensagens da
// conversa — separador de dia, hora, status e o filtro por telefone. Funções
// puras, usadas pela tela e provadas por ela.
import { normalizarNumero, variantesNumero } from '@/domain/whatsapp/numero';

/** T-290: a mídia da mensagem, quando ela tem uma (o arquivo abre por `/api/whatsapp/midia/:id`). */
export interface MidiaDaMensagemView {
  tipo: 'audio' | 'imagem' | 'video' | 'documento' | 'figurinha';
  mimetype: string | null;
  nome: string | null;
}

export interface MensagemDaConversa {
  id: string;
  mensagem: string;
  direcao: 'enviada' | 'recebida';
  created_at: string;
  numero: string;
  status: string;
  midia?: MidiaDaMensagemView;
  /** Dá para reagir (a mensagem tem o id da Evolution). Ausente = não. */
  reagivel?: boolean;
  /** Uma reação por pessoa: a da empresa (`nos`) e/ou a do cliente (`contato`). */
  reacoes?: { autor: 'nos' | 'contato'; emoji: string }[];
}

export interface TelefoneDoLead {
  /** Só os telefones extras têm id; o principal vem do cadastro do lead. */
  id?: string;
  numero: string;
  rotulo?: string | null;
  principal: boolean;
}

export type StatusDaMensagem = 'enviada' | 'entregue' | 'lida';

/** ASM-146: status gravado → "enviada", "entregue" ou "lida"; valor desconhecido aparece como "enviada". */
export function statusDaMensagem(status: string): StatusDaMensagem {
  const limpo = status.trim().toLowerCase();
  if (limpo === 'lida' || limpo === 'read') return 'lida';
  if (limpo === 'entregue' || limpo === 'delivered' || limpo === 'delivery_ack') return 'entregue';
  return 'enviada';
}

export function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function chaveDoDia(data: Date): string {
  return `${data.getFullYear()}-${data.getMonth()}-${data.getDate()}`;
}

/** "Hoje", "Ontem" ou a data (dd/mm/aaaa) — AC-437. */
export function rotuloDoDia(iso: string, agora: Date = new Date()): string {
  const dia = new Date(iso);
  if (chaveDoDia(dia) === chaveDoDia(agora)) return 'Hoje';
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (chaveDoDia(dia) === chaveDoDia(ontem)) return 'Ontem';
  return dia.toLocaleDateString('pt-BR');
}

export interface GrupoDoDia {
  rotulo: string;
  mensagens: MensagemDaConversa[];
}

/** Mensagens em ordem de hora, agrupadas por dia (AC-437). */
export function agruparPorDia(mensagens: MensagemDaConversa[], agora: Date = new Date()): GrupoDoDia[] {
  const ordenadas = [...mensagens].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const grupos: GrupoDoDia[] = [];
  let chaveAtual = '';
  for (const mensagem of ordenadas) {
    const chave = chaveDoDia(new Date(mensagem.created_at));
    if (chave !== chaveAtual) {
      grupos.push({ rotulo: rotuloDoDia(mensagem.created_at, agora), mensagens: [] });
      chaveAtual = chave;
    }
    grupos[grupos.length - 1].mensagens.push(mensagem);
  }
  return grupos;
}

/** A mensagem é do telefone escolhido? Compara pelo número normalizado e pelas variantes do nono dígito (ASM-039). */
export function mensagemDoTelefone(mensagem: MensagemDaConversa, telefone: TelefoneDoLead): boolean {
  const alvo = normalizarNumero(telefone.numero);
  const dela = normalizarNumero(mensagem.numero);
  if (!alvo || !dela) return false;
  return dela === alvo || variantesNumero(alvo).includes(dela);
}

export function rotuloDoTelefone(telefone: TelefoneDoLead): string {
  const partes = [telefone.numero];
  if (telefone.rotulo) partes.push(telefone.rotulo);
  if (telefone.principal) partes.push('Principal');
  return partes.join(' · ');
}

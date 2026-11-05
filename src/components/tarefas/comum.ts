// T-182 (fase4-tarefas-agenda, US-119/US-120): tipos e regras compartilhadas
// pela fila do turno (/tarefas) e pelas tarefas atrasadas (/tarefas/atrasadas).
import { nomeDaEtapa } from '@/components/pipeline/detalhe/jornada';

export type Canal = 'telefone' | 'whatsapp';
export type Tipo = 'ligacao' | 'mensagem' | 'breakup';
export type ResultadoToque = 'sem_resposta' | 'conectou';

/** Item de `GET /api/atividades?atrasados=1` (AC-469). */
export interface ItemDaFila {
  atividade: { id: string; sequencia: number; canal: Canal; tipo: Tipo };
  oportunidade: { id: string; version: number; etapaId: number; valor: string | null; responsavelId: string | null };
  lead: { id: string; nome: string; telefoneE164: string | null };
  atrasado: boolean;
  /** Toque de WhatsApp "aguardando resposta": o prazo (ISO) enquanto vale; `null` se não está aguardando. */
  aguardandoAte?: string | null;
  liberadaEm: string | null;
  responsavel: { id: string; nome: string } | null;
}

export interface ResumoDoTurno {
  turno: 'manha' | 'tarde' | null;
  toquesConcluidosTurno: number;
  toquesTotalTurno: number;
  conexoesHoje: number;
  semRespostaHoje: number;
  atrasados: number;
  receitaSobRisco: number;
  cardsEmRisco: number;
  ticketMedio: number | null;
  maiorAtraso: { minutos: number; leadNome: string } | null;
  aguardandoResposta?: number;
}

export const TOTAL_TOQUES = 18;

/** Rótulo do botão que conclui o toque sem resposta: no WhatsApp, enviar a mensagem já é fazer o toque; na ligação, é não ter sido atendido. */
export function rotuloSemResposta(canal: Canal): string {
  return canal === 'whatsapp' ? 'Mensagem enviada' : 'Não atendeu';
}

export const TIPO_LABEL: Record<Tipo, string> = { ligacao: 'Ligação', mensagem: 'Mensagem', breakup: 'Breakup' };
export const CANAL_LABEL: Record<Canal, string> = { telefone: 'Telefone', whatsapp: 'WhatsApp' };

export function nomeEtapa(etapaId: number): string {
  return nomeDaEtapa(etapaId);
}

export function iniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]!.toUpperCase())
    .join('');
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export function moeda(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  return MOEDA.format(Number(valor));
}

export function horaLocal(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

/** AC-474: "+3h 45m" (ou "+45m"). */
export function textoDoAtraso(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  const h = Math.floor(m / 60);
  return h > 0 ? `+${h}h ${String(m % 60).padStart(2, '0')}m` : `+${m}m`;
}

export function minutosDeAtraso(iso: string | null, agora: number): number {
  return iso ? Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60_000)) : 0;
}

/** ASM-162: cor do atraso é só visual — até 1 h âmbar, de 1 h a 4 h laranja, acima de 4 h vermelho. */
export type FaixaDeAtraso = 'ate1h' | 'de1a4h' | 'mais4h';
export function faixaDeAtraso(minutos: number): FaixaDeAtraso {
  return minutos > 240 ? 'mais4h' : minutos > 60 ? 'de1a4h' : 'ate1h';
}

/** AC-465/AC-476: mensagem em português por motivo de recusa da conclusão. */
const MENSAGENS_ERRO: Record<string, string> = {
  CONFLITO_DE_VERSAO: 'Este card foi alterado por outra ação enquanto você respondia. A fila foi recarregada.',
  TURNO_NAO_LIBERADO: 'Este toque ainda não foi liberado para o turno atual. A fila foi recarregada.',
  BLOCO_ANTERIOR_PENDENTE: 'O bloco anterior deste card ainda não foi concluído. A fila foi recarregada.',
  CADENCIA_ENCERRADA: 'Esta cadência já foi encerrada, ou este toque não está mais pendente. A fila foi recarregada.',
  PAPEL_NAO_PERMITIDO: 'Você não tem permissão para concluir este toque.',
  SEM_PERMISSAO: 'Você não tem permissão para mexer neste toque.',
  TOQUE_NAO_ACEITA_AGUARDAR: 'Só toques de WhatsApp podem ficar aguardando resposta.',
};
const MENSAGEM_ERRO_PADRAO = 'Não foi possível concluir este toque. A fila foi recarregada.';

export async function concluirToque(
  item: ItemDaFila,
  resultado: ResultadoToque
): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  try {
    const resposta = await fetch(`/api/atividades/${item.atividade.id}/concluir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: item.oportunidade.version, resultado }),
    });
    if (resposta.ok) return { ok: true };
    const corpo = (await resposta.json().catch(() => ({}))) as { codigo?: string };
    return { ok: false, mensagem: (corpo.codigo && MENSAGENS_ERRO[corpo.codigo]) ?? MENSAGEM_ERRO_PADRAO };
  } catch {
    return { ok: false, mensagem: MENSAGEM_ERRO_PADRAO };
  }
}

/** Ordem da fila (AC-466): atrasados primeiro, depois pelo horário de liberação; quem aguarda resposta vai para o fim. */
export function ordenarFila(itens: ItemDaFila[]): ItemDaFila[] {
  return [...itens].sort(
    (a, b) =>
      Number(Boolean(a.aguardandoAte)) - Number(Boolean(b.aguardandoAte)) ||
      Number(b.atrasado) - Number(a.atrasado) ||
      (a.liberadaEm ?? '').localeCompare(b.liberadaEm ?? '') ||
      a.atividade.sequencia - b.atividade.sequencia
  );
}

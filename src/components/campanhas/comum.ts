// T-197 (fase4-campanhas, US-129/US-131): tipos e formatação compartilhados pelas
// telas de campanhas (lista, nova e detalhe).
export interface ContagensView {
  rascunho: number;
  pendente: number;
  enviado: number;
  aberto: number;
  clicado: number;
  erro: number;
}

export interface CampanhaDaLista {
  id: string;
  nome: string;
  assunto: string;
  status: 'RASCUNHO' | 'PROCESSANDO' | 'FINALIZADA' | string;
  totalDestinatarios: number;
  criadoEm: string;
  contagens: ContagensView;
}

export interface ResumoView {
  disparosNoMes: number;
  taxaEntrega: number | null;
  taxaAbertura: number | null;
  taxaCliques: number | null;
}

/** ASM-181: o rótulo de cada status da campanha. */
export const ROTULO_DA_CAMPANHA: Record<string, string> = { RASCUNHO: 'Rascunho', PROCESSANDO: 'Enviando', FINALIZADA: 'Concluída' };

/** ASM-181: o rótulo de cada status do destinatário. */
export const ROTULO_DO_DESTINATARIO: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  PENDENTE: 'Na fila',
  ENVIADO: 'Enviado',
  ABERTO: 'Aberto',
  CLICADO: 'Clicou',
  ERRO: 'Falha',
};

export const COR_DA_CAMPANHA: Record<string, string> = {
  RASCUNHO: 'bg-surface-container text-text-secondary',
  PROCESSANDO: 'bg-info-surface text-primary',
  FINALIZADA: 'bg-success-surface text-success-text',
};

export const COR_DO_DESTINATARIO: Record<string, string> = {
  RASCUNHO: 'bg-surface-container text-text-secondary',
  PENDENTE: 'bg-warning-surface text-warning-text',
  ENVIADO: 'bg-info-surface text-info-text',
  ABERTO: 'bg-info-surface text-primary',
  CLICADO: 'bg-success-surface text-success-text',
  ERRO: 'bg-danger-surface text-danger-text',
};

/** ASM-182: "enviado" = ENVIADO, ABERTO ou CLICADO. */
export function totalEnviados(c: ContagensView): number {
  return c.enviado + c.aberto + c.clicado;
}

/** Porcentagem com uma casa decimal e vírgula ("28,6%"), ou traço sem base. */
export function formatarPorcentagem(valor: number | null): string {
  return valor === null ? '—' : `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function porcentagemDe(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
}

export function formatarData(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter((p) => /[A-Za-zÀ-ú]/.test(p[0] ?? ''));
  return (partes.length ? partes : [nome]).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '#';
}

/** AC-537/AC-549/AC-551: o motivo, em português, de cada recusa das ações. */
export const MENSAGENS_DE_ERRO: Record<string, string> = {
  CAMPANHA_EM_ENVIO: 'A campanha está enviando e não pode ser excluída agora.',
  CAMPANHA_NAO_ENCONTRADA: 'Campanha não encontrada.',
  CAMPANHA_JA_INICIADA: 'Esta campanha já foi iniciada.',
  SEM_DESTINATARIOS: 'Esta campanha não tem destinatários para enviar.',
  SEM_FALHAS: 'Não há falhas para reenviar.',
  CAMPANHA_NAO_EDITAVEL: 'Esta campanha já foi iniciada e não pode ser editada.',
  SEM_PERMISSAO: 'Campanhas são para gerente e master.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

export function mensagemDeErro(codigo: string | undefined, padrao = 'Não foi possível concluir a ação. Tente de novo.'): string {
  return (codigo && MENSAGENS_DE_ERRO[codigo]) || padrao;
}

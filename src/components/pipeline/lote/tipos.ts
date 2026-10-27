// T-178 (fase4-pipeline-lote, US-115 a US-117): o formato da resposta dos lotes
// (`POST /api/oportunidades/lote/{mover,reatribuir,arquivar}`, T-176/T-177) e
// as mensagens em português de cada motivo de falha de um card.

export type AcaoEmLote = 'mover' | 'reatribuir' | 'arquivar';

export interface ResultadoDoCardView {
  id: string;
  ok: boolean;
  codigo?: string;
}

export interface ResultadoDoLoteView {
  resultados: ResultadoDoCardView[];
  aplicados: number;
  falhas: number;
}

/** Verbo no plural de cada ação, para o resumo "N movidos, M não movidos". */
export const ROTULO_DA_ACAO: Record<AcaoEmLote, { feitos: string; naoFeitos: string; botao: string }> = {
  mover: { feitos: 'movidos', naoFeitos: 'não movidos', botao: 'Mover' },
  reatribuir: { feitos: 'reatribuídos', naoFeitos: 'não reatribuídos', botao: 'Reatribuir' },
  arquivar: { feitos: 'arquivados', naoFeitos: 'não arquivados', botao: 'Arquivar' },
};

/** AC-447: o motivo, em português, de cada recusa de um card. */
export const MENSAGEM_DO_CODIGO: Record<string, string> = {
  TRANSICAO_NAO_PERMITIDA: 'Essa etapa não pode ser alcançada a partir da etapa atual do card.',
  PAPEL_NAO_PERMITIDO: 'Seu papel não tem permissão para essa mudança.',
  VALOR_OBRIGATORIO: 'Falta informar o valor do card.',
  MOTIVO_PERDA_OBRIGATORIO: 'Falta informar o motivo de perda.',
  PROXIMA_ACAO_OBRIGATORIA: 'Falta informar a próxima ação do card.',
  EVIDENCIA_OBRIGATORIA: 'Falta enviar a evidência (anexo) do card.',
  JUSTIFICATIVA_OBRIGATORIA: 'Falta a justificativa da mudança.',
  CONFLITO_DE_VERSAO: 'Outra pessoa mexeu neste card ao mesmo tempo. Tente de novo.',
  OPORTUNIDADE_NAO_ENCONTRADA: 'Card não encontrado (pode ter sido removido).',
};

export function mensagemDoCodigo(codigo: string | undefined): string {
  return (codigo && MENSAGEM_DO_CODIGO[codigo]) || 'Não foi possível aplicar neste card.';
}

/** Recusa do PEDIDO inteiro (antes de mexer em qualquer card). */
export const MENSAGEM_DO_PEDIDO: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  RESPONSAVEL_INVALIDO: 'Esse responsável não está ativo nesta empresa.',
  MOTIVO_OBRIGATORIO: 'Escolha o motivo da perda.',
  MOTIVO_INVALIDO: 'Esse motivo de perda não existe ou está inativo.',
  REQUISICAO_INVALIDA: 'Seleção inválida: marque de 1 a 100 cards.',
};

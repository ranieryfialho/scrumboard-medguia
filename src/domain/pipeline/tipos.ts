// T-034 (fase1-dominio-pipeline, US-021): tipos do módulo de domínio puro que
// valida transições de etapa do pipeline. Espelham, em TypeScript, as colunas
// já entregues por `src/db/schema/pipeline.ts` (fase1-schema-drizzle) — este
// módulo não importa Drizzle nem faz I/O; quem chama monta esses objetos a
// partir do que já leu do banco.

export type PapelUsuario = 'MASTER' | 'GERENTE' | 'ATENDENTE';

/** Espelha as colunas de `pipeline_etapas` usadas pelos guards (T-036). */
export interface PipelineEtapa {
  id: number;
  exigeValor: boolean;
  exigeMotivo: boolean;
  exigeProximaAcao: boolean;
  exigeEvidencia: boolean;
}

/** Espelha uma linha de `pipeline_transicoes` (o grafo permitido, T-034). */
export interface PipelineTransicao {
  etapaOrigemId: number;
  etapaDestinoId: number;
  exigeJustificativa: boolean;
  papeisPermitidos: PapelUsuario[];
}

/** O ator que está tentando a transição, com papel já resolvido pela sessão (fase1-auth-rbac). */
export interface AtorTransicao {
  papel: PapelUsuario;
  isSuperAdmin: boolean;
}

/** Os dados informados junto com o pedido de transição. */
export interface DadosTransicao {
  valor?: number | null;
  motivoPerdaId?: string | null;
  proximaAcaoEm?: Date | null;
  anexoId?: string | null;
  justificativa?: string | null;
}

export type CodigoErroTransicao =
  | 'TRANSICAO_NAO_PERMITIDA'
  | 'PAPEL_NAO_PERMITIDO'
  | 'VALOR_OBRIGATORIO'
  | 'MOTIVO_PERDA_OBRIGATORIO'
  | 'PROXIMA_ACAO_OBRIGATORIA'
  | 'EVIDENCIA_OBRIGATORIA'
  | 'JUSTIFICATIVA_OBRIGATORIA';

export type ResultadoValidacao = { ok: true } | { ok: false; erro: CodigoErroTransicao };

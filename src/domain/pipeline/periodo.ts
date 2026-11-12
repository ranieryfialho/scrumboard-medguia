// fase6-periodo-personalizado (US-195, AC-824): o período (De/Até + qual data) das telas de lista, funil e arquivados.
// Função pura: as rotas de lista, arquivados e suas exportações leem os mesmos parâmetros por aqui, então a regra de
// validação não tem cópia.

/** Qual data do card o intervalo filtra: a entrada do lead ou a última mudança de etapa. */
export type CampoDataPeriodo = 'entrada' | 'movimentacao';

export const CAMPOS_DE_DATA: readonly CampoDataPeriodo[] = ['entrada', 'movimentacao'];

export interface PeriodoDaConsulta {
  /** Início (`YYYY-MM-DD`, inclusivo, `America/Sao_Paulo`). */
  de?: string;
  /** Fim (`YYYY-MM-DD`, inclusivo, `America/Sao_Paulo`). */
  ate?: string;
  data?: CampoDataPeriodo;
}

export type LeituraDoPeriodo = { ok: true; periodo: PeriodoDaConsulta } | { ok: false };

const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

function ehDataReal(texto: string): boolean {
  if (!FORMATO.test(texto)) return false;
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === texto;
}

/**
 * Lê `de`, `ate` e `data` da consulta. Parâmetro ausente ou vazio fica `undefined` (o filtro de datas só vale se houver
 * `de` ou `ate`); formato fora de `AAAA-MM-DD`, data que não existe, `ate` antes de `de` ou `data` desconhecida recusam
 * tudo (`ok: false`), e a rota responde 400 `PERIODO_INVALIDO` sem consultar o banco.
 */
export function lerPeriodoDaConsulta(parametros: URLSearchParams): LeituraDoPeriodo {
  const de = parametros.get('de') || undefined;
  const ate = parametros.get('ate') || undefined;
  const data = parametros.get('data') || undefined;

  if (de !== undefined && !ehDataReal(de)) return { ok: false };
  if (ate !== undefined && !ehDataReal(ate)) return { ok: false };
  if (de !== undefined && ate !== undefined && ate < de) return { ok: false };
  if (data !== undefined && !CAMPOS_DE_DATA.includes(data as CampoDataPeriodo)) return { ok: false };

  return { ok: true, periodo: { de, ate, data: data as CampoDataPeriodo | undefined } };
}

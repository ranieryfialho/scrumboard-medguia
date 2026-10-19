// T-117 (fase3-etl-sheets, US-077): traduz o status bruto da planilha para a
// etapa do pipeline novo (ou para a fila de revisão), seguindo o RFC-001
// §6.8 e o `STATUS_MAP` do legado (ASM-093).
//
// AC-279 — CREATED/vazio/"Novos Leads" vão para "Entrada de leads"; "Reunião
// agendada" vai para a etapa homônima.
// AC-280 — "Fechado"/"Logins Ativados"/"Fechamento de Clientes" vão para
// "Contrato (Ganho)"; a `dataFechamento` recebida é só devolvida junto da
// decisão (nunca reformatada ou descartada aqui) — quem grava o card
// (T-118) é quem decide onde ela entra no registro.
// AC-281 — "Sem interesse", "Desqualificado" e "Arquivado" vão para
// "Perdido" com o motivo próprio de cada um.
// AC-282 — "Recontato" (destino seria "Follow de longo prazo") e "Aguardando
// Ativação" (destino seria "Teste (Trial)") só geram etapa quando há data de
// próxima ação; como as planilhas nunca têm essa coluna (Q-031), na prática
// essas duas situações sempre caem na fila de revisão — mas a função aceita
// `dataProximaAcao` para não inventar uma regra diferente da decidida.
// AC-283 — qualquer status fora do mapa cai na fila de revisão (nunca em
// "Entrada de leads" por padrão, ao contrário do legado).
//
// Mesma normalização de chave (minúsculo, sem acento, trim) usada em
// `dedupe.ts` — só assim "Recontato", "recontato " e "RECONTATO" caem na
// mesma regra.

// Mesmos ids do seed imutável de `pipeline_etapas` (drizzle/0005_seeds.sql).
export const ETAPA_ENTRADA_DE_LEADS = 1;
export const ETAPA_FOLLOW_DE_LONGO_PRAZO = 7;
export const ETAPA_REUNIAO_AGENDADA = 8;
export const ETAPA_TESTE_TRIAL = 12;
export const ETAPA_PERDIDO = 14;
export const ETAPA_CONTRATO_GANHO = 15;

export const MOTIVO_SEM_INTERESSE = 'Sem interesse';
export const MOTIVO_DESQUALIFICADO_MIGRACAO = 'Desqualificado (migração)';
export const MOTIVO_LEGADO_ARQUIVADO = 'Legado — arquivado';

export interface OpcoesMapaStatus {
  /** `data_fechamento` bruta da planilha, devolvida sem alteração (AC-280). */
  dataFechamento?: string;
  /** Planilhas não têm essa coluna hoje (Q-031) — aceita mesmo assim para não fixar a regra em "sempre revisão" por acidente. */
  dataProximaAcao?: string;
}

export interface DecisaoEtapaStatus {
  tipo: 'etapa';
  etapaId: number;
  motivoPerdaNome?: string;
  dataFechamento?: string;
}

export interface DecisaoRevisaoStatus {
  tipo: 'revisao';
  motivo: string;
}

export type ResultadoMapaStatus = DecisaoEtapaStatus | DecisaoRevisaoStatus;

function normalizarChaveStatus(situacaoBruta: string): string {
  return situacaoBruta
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const CHAVES_ENTRADA_DE_LEADS = new Set(['created', '', 'novos leads']);
const CHAVES_CONTRATO_GANHO = new Set(['fechado', 'logins ativados', 'fechamento de clientes']);

/**
 * Traduz o status bruto de uma linha da planilha em etapa do pipeline ou em
 * motivo de revisão manual (AC-279 a AC-283). Nunca lança: todo status não
 * reconhecido é tratado pelo caminho de revisão (AC-283).
 */
export function mapearStatusParaEtapa(
  situacaoBruta: string,
  opcoes: OpcoesMapaStatus = {}
): ResultadoMapaStatus {
  const chave = normalizarChaveStatus(situacaoBruta);

  if (CHAVES_ENTRADA_DE_LEADS.has(chave)) {
    return { tipo: 'etapa', etapaId: ETAPA_ENTRADA_DE_LEADS };
  }

  if (chave === 'reuniao agendada') {
    return { tipo: 'etapa', etapaId: ETAPA_REUNIAO_AGENDADA };
  }

  if (CHAVES_CONTRATO_GANHO.has(chave)) {
    return { tipo: 'etapa', etapaId: ETAPA_CONTRATO_GANHO, dataFechamento: opcoes.dataFechamento };
  }

  if (chave === 'sem interesse') {
    return { tipo: 'etapa', etapaId: ETAPA_PERDIDO, motivoPerdaNome: MOTIVO_SEM_INTERESSE };
  }

  if (chave === 'desqualificado') {
    return { tipo: 'etapa', etapaId: ETAPA_PERDIDO, motivoPerdaNome: MOTIVO_DESQUALIFICADO_MIGRACAO };
  }

  if (chave === 'arquivado') {
    return { tipo: 'etapa', etapaId: ETAPA_PERDIDO, motivoPerdaNome: MOTIVO_LEGADO_ARQUIVADO };
  }

  if (chave === 'recontato') {
    if (opcoes.dataProximaAcao) {
      return { tipo: 'etapa', etapaId: ETAPA_FOLLOW_DE_LONGO_PRAZO };
    }
    return { tipo: 'revisao', motivo: 'Recontato sem data de próxima ação' };
  }

  if (chave === 'aguardando ativacao') {
    if (opcoes.dataProximaAcao) {
      return { tipo: 'etapa', etapaId: ETAPA_TESTE_TRIAL };
    }
    return { tipo: 'revisao', motivo: 'Aguardando Ativação sem data de próxima ação' };
  }

  return { tipo: 'revisao', motivo: `status desconhecido: "${situacaoBruta}"` };
}

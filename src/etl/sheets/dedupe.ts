// T-116 (fase3-etl-sheets, US-075): deduplicação entre abas e resolução de
// conflito.
//
// AC-275 — o mesmo lead pode aparecer em mais de uma aba ou planilha (ASM-090:
// a chave é o id da Meta, `l:…`, nunca a linha). Este módulo agrupa as
// ocorrências por `metaId` e devolve um único `LeadBruto` por grupo, mesmo
// que `created_time`/`data_alteracao` venham com fusos diferentes em cada
// aba (já resolvido por `normalizarData`, T-115, antes de chegar aqui).
//
// AC-276 — quando duas ocorrências do mesmo lead têm status diferentes
// (`situacaoBruta`), vence a de `data_alteracao` mais recente (ASM-091).
// Sem data válida em nenhum lado, vence o status mais avançado do funil —
// a ordem usada aqui (`ORDEM_FUNIL`) é só para este desempate; a tradução
// completa de status para etapa/motivo de perda é responsabilidade de T-117.
// Todo desempate por status (com ou sem data) é reportado em `conflitos`.
import { normalizarData } from './normalizar';
import type { LeadBruto } from './leitor';

/** Identifica de qual planilha/aba veio uma ocorrência do lead (AC-285 usa a mesma origem). */
export interface OrigemLead {
  planilha: string;
  aba: string;
}

export interface LeadComOrigem {
  origem: OrigemLead;
  lead: LeadBruto;
}

export type MotivoDecisaoConflito = 'data_alteracao' | 'status_mais_avancado';

/** Um conflito de status para o mesmo `metaId`, reportado mesmo quando já resolvido (AC-276). */
export interface ConflitoDedupe {
  metaId: string;
  situacoes: string[];
  situacaoVencedora: string;
  origens: OrigemLead[];
  motivoDecisao: MotivoDecisaoConflito;
}

export interface LeadDeduplicado {
  lead: LeadBruto;
  origem: OrigemLead;
  /** Todas as origens onde este `metaId` apareceu (1 quando não havia duplicata). */
  origens: OrigemLead[];
}

export interface ResultadoDedupe {
  leads: LeadDeduplicado[];
  conflitos: ConflitoDedupe[];
}

function normalizarChaveStatus(situacaoBruta: string): string {
  return situacaoBruta
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Ordem usada só para desempatar conflitos sem data (AC-276, ASM-091) — não é
 * o mapa de etapas final (isso é T-117). Status fora do mapa ficam no rank
 * mais baixo: não devem vencer um status reconhecido.
 */
const ORDEM_FUNIL: Record<string, number> = {
  '': 0,
  'created': 0,
  'new': 0,
  'novo': 0,
  'novos leads': 0,
  'sem situacao': 0,
  'recontato': 1,
  'reuniao agendada': 2,
  'meeting scheduled': 2,
  'aguardando ativacao': 3,
  'pending activation': 3,
  'fechado': 4,
  'logins ativados': 4,
  'closed': 4,
  'won': 4,
  'fechamento de clientes': 4,
  'sem interesse': 5,
  'not interested': 5,
  'desqualificado': 5,
  'disqualified': 5,
  'arquivado': 5,
  'archived': 5,
};

function rankDoStatus(situacaoBruta: string): number {
  const chave = normalizarChaveStatus(situacaoBruta);
  return ORDEM_FUNIL[chave] ?? -1;
}

function dataAlteracaoDe(entrada: LeadComOrigem): number | undefined {
  const bruta = entrada.lead.camposExtras['data_alteracao'];
  const normalizada = normalizarData(bruta);
  if (!normalizada) return undefined;
  const instante = new Date(normalizada).getTime();
  return Number.isNaN(instante) ? undefined : instante;
}

/**
 * Entre ocorrências do mesmo `metaId` com status diferentes, decide qual
 * vence (AC-276): data mais recente primeiro; sem nenhuma data válida,
 * status mais avançado do funil.
 */
function escolherVencedora(
  grupo: LeadComOrigem[]
): { vencedora: LeadComOrigem; motivo: MotivoDecisaoConflito } {
  const comData = grupo
    .map((entrada) => ({ entrada, instante: dataAlteracaoDe(entrada) }))
    .filter((item): item is { entrada: LeadComOrigem; instante: number } => item.instante !== undefined);

  if (comData.length > 0) {
    const maisRecente = comData.reduce((melhor, atual) => (atual.instante > melhor.instante ? atual : melhor));
    return { vencedora: maisRecente.entrada, motivo: 'data_alteracao' };
  }

  const maisAvancada = grupo.reduce((melhor, atual) =>
    rankDoStatus(atual.lead.situacaoBruta) > rankDoStatus(melhor.lead.situacaoBruta) ? atual : melhor
  );
  return { vencedora: maisAvancada, motivo: 'status_mais_avancado' };
}

/**
 * Agrupa ocorrências do mesmo lead (por `metaId`, ASM-090) vindas de
 * qualquer aba/planilha em um único `LeadBruto` (AC-275), resolvendo
 * conflitos de status pelo critério de AC-276. Leads sem `metaId` (aba sem
 * essa coluna) não têm como ser comparados entre si e seguem cada um como
 * ocorrência única.
 */
export function deduplicarLeads(entradas: LeadComOrigem[]): ResultadoDedupe {
  const porMetaId = new Map<string, LeadComOrigem[]>();
  const semMetaId: LeadComOrigem[] = [];

  entradas.forEach((entrada) => {
    const metaId = entrada.lead.metaId.trim();
    if (!metaId) {
      semMetaId.push(entrada);
      return;
    }
    const grupo = porMetaId.get(metaId);
    if (grupo) {
      grupo.push(entrada);
    } else {
      porMetaId.set(metaId, [entrada]);
    }
  });

  const leads: LeadDeduplicado[] = [];
  const conflitos: ConflitoDedupe[] = [];

  porMetaId.forEach((grupo, metaId) => {
    const origens = grupo.map((entrada) => entrada.origem);
    const situacoes = grupo.map((entrada) => entrada.lead.situacaoBruta);
    const situacoesUnicas = Array.from(new Set(situacoes.map((s) => normalizarChaveStatus(s))));

    if (situacoesUnicas.length <= 1) {
      leads.push({ lead: grupo[0].lead, origem: grupo[0].origem, origens });
      return;
    }

    const { vencedora, motivo } = escolherVencedora(grupo);
    leads.push({ lead: vencedora.lead, origem: vencedora.origem, origens });
    conflitos.push({
      metaId,
      situacoes,
      situacaoVencedora: vencedora.lead.situacaoBruta,
      origens,
      motivoDecisao: motivo,
    });
  });

  semMetaId.forEach((entrada) => {
    leads.push({ lead: entrada.lead, origem: entrada.origem, origens: [entrada.origem] });
  });

  return { leads, conflitos };
}

// T-245 (fase5-whatsapp-lote-base, AC-674/AC-675, ASM-243/ASM-245): as regras do lote de WhatsApp e a
// prévia de quem receberia — funções puras, sem banco. Quem decide os dados é o repositório.
import { variantesNumero } from '../../domain/whatsapp/numero';
import { renderizarTemplate, type ContextoDoTemplate } from './template';

export const LIMITE_POR_DISPARO = 50;
export const INTERVALO_MINIMO_SEGUNDOS = 15;
export const INTERVALO_MAXIMO_SEGUNDOS = 45;
export const MAXIMO_DE_IDS_NA_PREVIA = 500;

/** AC-674: um intervalo (em segundos, inteiro) sempre dentro da faixa; `aleatorio` é injetável para teste. */
export function sortearIntervaloSegundos(aleatorio: () => number = Math.random): number {
  const faixa = INTERVALO_MAXIMO_SEGUNDOS - INTERVALO_MINIMO_SEGUNDOS + 1;
  return INTERVALO_MINIMO_SEGUNDOS + Math.min(faixa - 1, Math.floor(aleatorio() * faixa));
}

/** ASM-243: o intervalo médio × (elegíveis − 1); um lote de 0 ou 1 mensagem não espera nada. */
export function duracaoEstimadaSegundos(elegiveis: number): number {
  const medio = (INTERVALO_MINIMO_SEGUNDOS + INTERVALO_MAXIMO_SEGUNDOS) / 2;
  return Math.max(0, elegiveis - 1) * medio;
}

export type MotivoDeExclusao = 'SEM_CONSENTIMENTO' | 'SEM_TELEFONE' | 'TELEFONE_REPETIDO' | 'ACIMA_DO_LIMITE' | 'LEAD_NAO_ENCONTRADO';

export interface LeadDoLote {
  id: string;
  nome: string;
  telefone: string | null;
  consentimento: boolean;
}

export interface PreviaDoLote {
  elegiveis: Array<{ leadId: string; nome: string; telefone: string; mensagem: string }>;
  excluidos: Array<{ leadId: string; nome: string | null; motivo: MotivoDeExclusao }>;
  limite: number;
  intervalo: { minimoSegundos: number; maximoSegundos: number };
  duracaoEstimadaSegundos: number;
}

/**
 * AC-675: `ids` na ordem pedida; `leads` o que o banco achou na empresa. Um lead entra se tem telefone e
 * consentimento, o número não repete o de outro já aceito (qualquer grafia do nono dígito) e ainda cabe no limite.
 */
export function montarPrevia(ids: string[], leads: LeadDoLote[], corpoDoTemplate: string, contextos: Map<string, ContextoDoTemplate> = new Map()): PreviaDoLote {
  const porId = new Map(leads.map((l) => [l.id, l]));
  const elegiveis: PreviaDoLote['elegiveis'] = [];
  const excluidos: PreviaDoLote['excluidos'] = [];
  const numerosAceitos = new Set<string>();
  const vistos = new Set<string>();

  for (const id of ids) {
    if (vistos.has(id)) continue; // o mesmo lead duas vezes na lista conta uma só
    vistos.add(id);
    const lead = porId.get(id);
    if (!lead) {
      excluidos.push({ leadId: id, nome: null, motivo: 'LEAD_NAO_ENCONTRADO' });
      continue;
    }
    const digitos = (lead.telefone ?? '').replace(/\D/g, '');
    if (!digitos) {
      excluidos.push({ leadId: id, nome: lead.nome, motivo: 'SEM_TELEFONE' });
      continue;
    }
    if (!lead.consentimento) {
      excluidos.push({ leadId: id, nome: lead.nome, motivo: 'SEM_CONSENTIMENTO' });
      continue;
    }
    if (variantesNumero(digitos).some((v) => numerosAceitos.has(v))) {
      excluidos.push({ leadId: id, nome: lead.nome, motivo: 'TELEFONE_REPETIDO' });
      continue;
    }
    if (elegiveis.length >= LIMITE_POR_DISPARO) {
      excluidos.push({ leadId: id, nome: lead.nome, motivo: 'ACIMA_DO_LIMITE' });
      continue;
    }
    for (const v of variantesNumero(digitos)) numerosAceitos.add(v);
    elegiveis.push({ leadId: id, nome: lead.nome, telefone: digitos, mensagem: renderizarTemplate(corpoDoTemplate, { ...contextos.get(id), nome: lead.nome }) });
  }

  return {
    elegiveis,
    excluidos,
    limite: LIMITE_POR_DISPARO,
    intervalo: { minimoSegundos: INTERVALO_MINIMO_SEGUNDOS, maximoSegundos: INTERVALO_MAXIMO_SEGUNDOS },
    duracaoEstimadaSegundos: duracaoEstimadaSegundos(elegiveis.length),
  };
}

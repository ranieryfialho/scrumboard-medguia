// T-119 (fase3-etl-sheets, US-079/US-080): a aba `Agenda` nunca migra para o
// CRM (ASM-092) — este módulo só a transforma em CSV, puro e sem nenhuma
// chamada ao banco, o que por si só já garante que nenhuma reunião é criada
// (AC-286). As colunas são lidas de forma posicional (`id`, `data`, `titulo`,
// `hora`), igual a `src/app/api/agenda/route.ts` (`A:D`) — a aba não tem
// cabeçalho nomeado como as abas de lead.
//
// A segunda metade liga mensagens de WhatsApp já migradas (`fase3-etl-supabase`,
// T-112) aos leads desta migração pelo telefone (AC-287): para cada mensagem
// sem lead (`lead_id is null`) na empresa, busca quantos leads da mesma
// empresa têm aquele `telefone_e164`. Exatamente um -> vincula. Zero ou mais
// de um -> a mensagem continua sem vínculo e entra numa das duas contagens do
// relatório (AC-288) — nunca escolhe um lead "no chute" num empate.
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import type { TransacaoEtl } from '../comum';
import { leads, whatsappMensagens } from '../../db/schema';

export interface LinhaAgenda {
  id: string;
  data: string;
  titulo: string;
  hora: string;
}

/**
 * Lê as linhas brutas da aba `Agenda` (posição A:D, sem cabeçalho nomeado) e
 * descarta só a primeira linha (cabeçalho) e linhas sem `id` (AC-286).
 */
export function lerAgenda(linhas: string[][]): LinhaAgenda[] {
  return linhas
    .slice(1)
    .map((linha) => ({
      id: (linha[0] ?? '').toString(),
      data: (linha[1] ?? '').toString(),
      titulo: (linha[2] ?? '').toString(),
      hora: (linha[3] ?? '').toString(),
    }))
    .filter((evento) => evento.id !== '');
}

function escaparCampoCsv(valor: string): string {
  if (/[",\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

/**
 * Gera o CSV da agenda com todas as linhas (AC-286). Função pura — não
 * escreve em disco nem toca o banco; nenhuma reunião nasce a partir daqui.
 */
export function gerarCsvAgenda(eventos: LinhaAgenda[]): string {
  const cabecalho = 'id,data,titulo,hora';
  const linhas = eventos.map((evento) =>
    [evento.id, evento.data, evento.titulo, evento.hora].map(escaparCampoCsv).join(',')
  );
  return [cabecalho, ...linhas].join('\n') + '\n';
}

export interface ResultadoVinculoMensagens {
  /** Quantas mensagens da empresa estavam sem lead antes desta etapa. */
  semLead: number;
  /** Vinculadas a um lead porque o telefone bateu com exatamente um (AC-287). */
  vinculadas: number;
  /** Telefone sem nenhum lead correspondente — continua sem vínculo (AC-288). */
  semLeadParaTelefone: number;
  /** Telefone com mais de um lead correspondente — continua sem vínculo (AC-288). */
  telefoneAmbiguo: number;
}

/**
 * AC-725: chave para comparar telefones. As mensagens do WhatsApp vêm sem o `+` e, em geral, sem o nono dígito (12
 * dígitos), enquanto os leads das planilhas vêm com `+` e com o nono dígito: a igualdade exata nunca casava. Para número
 * brasileiro a chave é país + DDD + os 8 últimos dígitos (os 8 últimos de um celular começam em 6–9 e os de um fixo em 2–5,
 * então nunca se confundem); os demais comparam só os dígitos.
 */
export function chaveDeTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.startsWith('55') && digitos.length >= 12) return `55${digitos.slice(2, 4)}${digitos.slice(-8)}`;
  return digitos;
}

/**
 * Liga mensagens de WhatsApp sem lead aos leads desta empresa pelo telefone
 * (AC-287, AC-725). Telefone ambíguo (mais de um lead) ou sem nenhum lead
 * correspondente fica como está — nunca adivinha (AC-288). Idempotente: uma
 * mensagem já vinculada (`lead_id` preenchido) não entra na busca, então
 * rodar de novo não desfaz nem refaz nada.
 */
export async function vincularMensagensPorTelefone(
  tx: TransacaoEtl,
  empresaId: string
): Promise<ResultadoVinculoMensagens> {
  const mensagensSemLead = await tx
    .select({ id: whatsappMensagens.id, numero: whatsappMensagens.numero })
    .from(whatsappMensagens)
    .where(and(eq(whatsappMensagens.empresaId, empresaId), isNull(whatsappMensagens.leadId)));

  const leadsDaEmpresa = await tx
    .select({ id: leads.id, telefone: leads.telefoneE164 })
    .from(leads)
    .where(and(eq(leads.empresaId, empresaId), isNotNull(leads.telefoneE164)));
  const leadsPorChave = new Map<string, string[]>();
  for (const lead of leadsDaEmpresa) {
    const chave = chaveDeTelefone(lead.telefone as string);
    if (chave) leadsPorChave.set(chave, [...(leadsPorChave.get(chave) ?? []), lead.id]);
  }

  let vinculadas = 0;
  let semLeadParaTelefone = 0;
  let telefoneAmbiguo = 0;

  for (const mensagem of mensagensSemLead) {
    const chave = chaveDeTelefone(mensagem.numero);
    const idsDeLeads = chave ? (leadsPorChave.get(chave) ?? []) : [];

    if (idsDeLeads.length === 0) {
      semLeadParaTelefone++;
      continue;
    }

    if (idsDeLeads.length > 1) {
      telefoneAmbiguo++;
      continue;
    }

    await tx
      .update(whatsappMensagens)
      .set({ leadId: idsDeLeads[0] })
      .where(eq(whatsappMensagens.id, mensagem.id));
    vinculadas++;
  }

  return {
    semLead: mensagensSemLead.length,
    vinculadas,
    semLeadParaTelefone,
    telefoneAmbiguo,
  };
}

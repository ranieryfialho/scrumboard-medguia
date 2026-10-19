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
import { and, eq, isNull } from 'drizzle-orm';

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
 * Liga mensagens de WhatsApp sem lead aos leads desta empresa pelo telefone
 * (AC-287). Telefone ambíguo (mais de um lead) ou sem nenhum lead
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

  let vinculadas = 0;
  let semLeadParaTelefone = 0;
  let telefoneAmbiguo = 0;

  const leadsPorNumero = new Map<string, string[]>();

  for (const mensagem of mensagensSemLead) {
    let idsDeLeads = leadsPorNumero.get(mensagem.numero);
    if (!idsDeLeads) {
      const encontrados = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.empresaId, empresaId), eq(leads.telefoneE164, mensagem.numero)));
      idsDeLeads = encontrados.map((lead) => lead.id);
      leadsPorNumero.set(mensagem.numero, idsDeLeads);
    }

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

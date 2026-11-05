// Os dados que preenchem os shortcodes de um template (lead, card, reunião, empresa) — um contexto por lead.
// O card usado é o mais recentemente atualizado do lead; a reunião é a próxima ainda não encerrada (ou a última marcada).
import { desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresas, leads, oportunidadeComercial, oportunidades, pipelineEtapas, reunioes, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import type { ContextoDoTemplate } from '../lib/whatsapp/template';
import { comTenant } from './contexto';

const FUSO = 'America/Sao_Paulo';

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

/** "5511988880001" → "(11) 98888-0001"; fora do padrão BR volta como está. */
export function telefoneLegivel(e164: string | null): string | undefined {
  if (!e164) return undefined;
  const m = /^\+?55(\d{2})(\d{4,5})(\d{4})$/.exec(e164.replace(/\s/g, ''));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

function moeda(valor: string | null): string | undefined {
  if (valor === null || valor === undefined) return undefined;
  const n = Number(valor);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined;
}

export function formatosDaReuniao(quando: Date): { data: string; hora: string; diaSemana: string } {
  return {
    data: new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' }).format(quando),
    hora: new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).format(quando),
    diaSemana: new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long' }).format(quando),
  };
}

/** A reunião que interessa ao lead: a mais próxima daqui em diante; sem futura, a mais recente. */
export function escolherReuniao<T extends { agendadaPara: Date }>(lista: T[], agora: Date): T | null {
  if (lista.length === 0) return null;
  const futuras = lista.filter((r) => r.agendadaPara >= agora).sort((a, b) => a.agendadaPara.getTime() - b.agendadaPara.getTime());
  if (futuras.length > 0) return futuras[0];
  return [...lista].sort((a, b) => b.agendadaPara.getTime() - a.agendadaPara.getTime())[0];
}

export async function contextosDosLeads(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  leadIds: string[],
  agora: Date = new Date()
): Promise<Map<string, ContextoDoTemplate>> {
  const mapa = new Map<string, ContextoDoTemplate>();
  if (leadIds.length === 0) return mapa;

  await comTenant(db, contexto, async (tx) => {
    const [empresa] = await tx.select({ nome: empresas.nome }).from(empresas).where(eq(empresas.id, contexto.empresaId)).limit(1);
    const dosLeads = await tx
      .select({ id: leads.id, nome: leads.nome, email: leads.email, origem: leads.origem, telefone: leads.telefoneE164, dados: leads.dados })
      .from(leads)
      .where(inArray(leads.id, leadIds));

    // O card mais recente de cada lead.
    const cards = await tx
      .select({
        id: oportunidades.id,
        leadId: oportunidades.leadId,
        valor: oportunidades.valor,
        etapa: pipelineEtapas.nome,
        responsavel: usuarios.nome,
      })
      .from(oportunidades)
      .leftJoin(pipelineEtapas, eq(pipelineEtapas.id, oportunidades.etapaId))
      .leftJoin(usuarios, eq(usuarios.id, oportunidades.responsavelId))
      .where(inArray(oportunidades.leadId, leadIds))
      .orderBy(desc(oportunidades.atualizadoEm));
    const cardDoLead = new Map<string, (typeof cards)[number]>();
    for (const c of cards) if (!cardDoLead.has(c.leadId)) cardDoLead.set(c.leadId, c);

    const cardIds = [...cardDoLead.values()].map((c) => c.id);
    const planos = cardIds.length
      ? await tx.select({ oportunidadeId: oportunidadeComercial.oportunidadeId, plano: oportunidadeComercial.plano }).from(oportunidadeComercial).where(inArray(oportunidadeComercial.oportunidadeId, cardIds))
      : [];
    const planoDoCard = new Map(planos.map((p) => [p.oportunidadeId, p.plano]));

    const marcadas = cardIds.length
      ? await tx
          .select({ oportunidadeId: reunioes.oportunidadeId, agendadaPara: reunioes.agendadaPara, meetUrl: reunioes.meetUrl, encerradaEm: reunioes.encerradaEm, noShow: reunioes.noShow })
          .from(reunioes)
          .where(inArray(reunioes.oportunidadeId, cardIds))
      : [];

    for (const lead of dosLeads) {
      const card = cardDoLead.get(lead.id);
      const dados = (lead.dados ?? {}) as Record<string, unknown>;
      const ctx: ContextoDoTemplate = {
        nome: lead.nome,
        telefone: telefoneLegivel(lead.telefone),
        email: texto(lead.email),
        especialidade: texto(dados.especialidade),
        origem: texto(lead.origem) ?? texto(dados.origem),
        empresa: empresa?.nome,
      };
      if (card) {
        ctx.etapa = card.etapa ?? undefined;
        ctx.valor = moeda(card.valor);
        ctx.plano = texto(planoDoCard.get(card.id));
        ctx.responsavel = card.responsavel ?? undefined;
        const reuniao = escolherReuniao(
          marcadas.filter((r) => r.oportunidadeId === card.id && r.encerradaEm === null && !r.noShow),
          agora
        );
        if (reuniao) {
          const f = formatosDaReuniao(reuniao.agendadaPara);
          ctx.data_reuniao = f.data;
          ctx.hora_reuniao = f.hora;
          ctx.dia_semana_reuniao = f.diaSemana;
          ctx.link_meet = texto(reuniao.meetUrl);
        }
      }
      mapa.set(lead.id, ctx);
    }
  });

  return mapa;
}

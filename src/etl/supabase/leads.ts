// T-110 (fase3-etl-supabase, US-070): migra leads do Supabase legado como
// lead + card do pipeline. Reaproveita o contrato de T-108
// (`buscarIdDestino`/`registrarMigracao`) para idempotência em reexecução
// (AC-267) — ao contrário de T-109 (empresa/usuário), o lead NÃO preserva o
// `id` do legado: ele nasce com um `id` novo (`defaultRandom`), e é por
// isso que AC-258 existe — o evento `migrado_de` e `migracao_registros`
// (entidade `lead`) são o único jeito de achar de onde um card veio.
//
// Mapa de situação → etapa (AC-256/AC-257/AC-259): "Novos Leads" (ou sem
// situação) é mapa direto para "Entrada de leads" (etapa 1); "Desqualificado"
// é mapa direto para "Perdido" (etapa 14) com o motivo sistêmico
// "Desqualificado (migração)" (ASM-082 — diverge do RFC-001 §6.8 de
// propósito, decisão do usuário em 19/10); qualquer outra situação (inclusive
// "Em contato" e situação desconhecida) não tem etapa automática — o lead
// NÃO é criado nesta execução, só entra na fila de revisão retornada em
// `resultado.revisao` (AC-259). Uma `decisao` para o mesmo `idExterno`
// resolve a fila numa execução seguinte (AC-272): o lead e o card nascem na
// etapa escolhida, e como passam a existir em `migracao_registros` eles não
// voltam a aparecer em `revisao` nem duplicam numa terceira execução.
//
// Telefone (AC-260): `normalizarNumero` (mesma função usada pelo envio e
// pelo histórico de WhatsApp — ASM-046/ASM-085, DDI 55 implícito) decide se
// o WhatsApp do legado vira telefone válido. Quando não vira, o lead migra
// do mesmo jeito (sem telefone) e entra em `revisao` com o motivo — ausência
// de telefone nunca bloqueia a criação do lead/card.
import { eq } from 'drizzle-orm';

import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { normalizarNumero } from '../../domain/whatsapp/numero';
import { leads, motivosPerda, oportunidadeEventos, oportunidades } from '../../db/schema';

export const ENTIDADE_LEAD = 'lead';

// Mesmos ids do seed imutável de `pipeline_etapas` (drizzle/0005_seeds.sql).
export const ETAPA_ENTRADA_DE_LEADS = 1;
export const ETAPA_PERDIDO = 14;

export const MOTIVO_DESQUALIFICADO_MIGRACAO = 'Desqualificado (migração)';

export interface LeadLegado {
  /** Id do lead no Supabase legado — chave de idempotência (`migracao_registros`) e do evento `migrado_de`. */
  id: string;
  empresaId: string;
  nome: string;
  email: string | null;
  /** Situação bruta do legado (ex.: "Novos Leads", "Desqualificado", "Em contato"), ou `null`. */
  situacao: string | null;
  origem: string | null;
  observacoes: string | null;
  /** Número de WhatsApp bruto do legado, sem normalização (pode estar vazio ou inválido). */
  whatsapp: string | null;
}

/** Decisão da operação para um lead que ficou na fila de revisão (AC-272). */
export interface DecisaoRevisao {
  idExterno: string;
  etapaId: number;
}

export type TipoItemRevisao = 'situacao_sem_etapa' | 'whatsapp_invalido';

export interface ItemRevisao {
  idExterno: string;
  tipo: TipoItemRevisao;
  motivo: string;
}

export interface ResultadoMigracaoLeads {
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
  revisao: ItemRevisao[];
}

function etapaDireta(situacao: string | null): number | null {
  if (!situacao || situacao === 'Novos Leads') return ETAPA_ENTRADA_DE_LEADS;
  if (situacao === 'Desqualificado') return ETAPA_PERDIDO;
  return null;
}

/**
 * Acha o motivo sistêmico "Desqualificado (migração)" ou cria na primeira
 * vez (idempotente via índice único em `nome` — reexecução reaproveita a
 * linha já existente, nunca duplica).
 */
async function obterMotivoDesqualificadoMigracao(tx: TransacaoEtl): Promise<string> {
  const [existente] = await tx
    .select({ id: motivosPerda.id })
    .from(motivosPerda)
    .where(eq(motivosPerda.nome, MOTIVO_DESQUALIFICADO_MIGRACAO));
  if (existente) return existente.id;

  const [criado] = await tx
    .insert(motivosPerda)
    .values({ nome: MOTIVO_DESQUALIFICADO_MIGRACAO, ativo: true, eSistemico: true })
    .returning({ id: motivosPerda.id });
  return criado.id;
}

/**
 * Migra os leads do legado como lead + card (AC-256/AC-257/AC-259/AC-260).
 * `decisoes` resolve, nesta execução, leads que ficaram na fila de revisão
 * em execuções anteriores (AC-272) — quem decide se uma decisão "vale" (ex.:
 * etapa existente, card ainda não criado) é só esta função; o arquivo de
 * decisões em si é responsabilidade do orquestrador (T-113).
 */
export async function migrarLeads(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  leadsLegado: LeadLegado[],
  decisoes: DecisaoRevisao[] = []
): Promise<ResultadoMigracaoLeads> {
  const etapaDecidida = new Map(decisoes.map((d) => [d.idExterno, d.etapaId]));

  let criadas = 0;
  let ignoradas = 0;
  let emRevisao = 0;
  const revisao: ItemRevisao[] = [];

  for (const lead of leadsLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, lead.id);
    if (existente) {
      ignoradas++;
      continue;
    }

    let etapaId = etapaDireta(lead.situacao);
    let motivoPerdaId: string | undefined;

    if (etapaId === ETAPA_PERDIDO) {
      motivoPerdaId = await obterMotivoDesqualificadoMigracao(tx);
    }

    if (etapaId === null) {
      const decisao = etapaDecidida.get(lead.id);
      if (decisao === undefined) {
        emRevisao++;
        revisao.push({
          idExterno: lead.id,
          tipo: 'situacao_sem_etapa',
          motivo: `situação sem etapa automática: "${lead.situacao ?? ''}"`,
        });
        continue;
      }
      etapaId = decisao;
    }

    let telefoneE164: string | null = null;
    if (lead.whatsapp) {
      const normalizado = normalizarNumero(lead.whatsapp);
      if (normalizado) {
        telefoneE164 = normalizado;
      } else {
        revisao.push({
          idExterno: lead.id,
          tipo: 'whatsapp_invalido',
          motivo: `WhatsApp não vira telefone válido: "${lead.whatsapp}"`,
        });
      }
    }

    const [novoLead] = await tx
      .insert(leads)
      .values({
        empresaId: lead.empresaId,
        nome: lead.nome,
        email: lead.email ?? null,
        origem: lead.origem ?? null,
        telefoneE164,
        idExterno: lead.id,
        dados: lead.observacoes ? { observacoes: lead.observacoes } : null,
      })
      .returning();

    const [novaOportunidade] = await tx
      .insert(oportunidades)
      .values({
        empresaId: lead.empresaId,
        leadId: novoLead.id,
        etapaId,
        motivoPerdaId: motivoPerdaId ?? null,
      })
      .returning();

    await tx.insert(oportunidadeEventos).values({
      empresaId: lead.empresaId,
      oportunidadeId: novaOportunidade.id,
      tipo: 'migrado_de',
      atorTipo: 'migracao',
      payload: { origem: contexto.origem, idExterno: lead.id },
    });

    await registrarMigracao(tx, contexto, {
      entidade: ENTIDADE_LEAD,
      idExterno: lead.id,
      idDestino: novoLead.id,
    });

    criadas++;
  }

  return { lidas: leadsLegado.length, criadas, ignoradas, emRevisao, revisao };
}

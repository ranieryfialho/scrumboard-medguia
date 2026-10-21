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
//
// T-126 (fase3-etl-decisoes, US-089): além do formato simples `{ idExterno,
// etapaId }` (`decisoes`, mantido para quem já chamava `migrarLeads` assim —
// só serve etapas sem exigência), um lead sem etapa automática também pode
// ser resolvido por uma decisão já validada da planilha comum (T-124,
// `decisoesValidadas`, casada por `lead.id`) — quem valida é o orquestrador
// (T-113), que tem a tabela `etapas` e o instante da execução. `etapa` cria
// o lead/card com `proximaAcaoEm`/`valor`/`motivoPerdaId` da decisão (AC-315);
// `ignorar` registra `lead_ignorado` sem criar nada; `recusada` mantém o
// lead em revisão com o motivo (mesma regra do Sheets, US-088).
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { normalizarNumero } from '../../domain/whatsapp/numero';
import type { ResultadoValidacao } from '../decisoes';
import { leads, motivosPerda, oportunidadeEventos, oportunidades } from '../../db/schema';

export const ENTIDADE_LEAD = 'lead';
/** Lead cuja decisão foi "ignorar" (T-126) — registrado só para sair da fila, sem FK para nenhuma tabela de negócio. */
export const ENTIDADE_LEAD_IGNORADO = 'lead_ignorado';

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

/** `decisao_recusada` (T-126): a planilha de decisões trazia algo para este `idExterno`, mas `validarDecisao` recusou — volta para a revisão com o motivo, sem abortar a execução. */
export type TipoItemRevisao = 'situacao_sem_etapa' | 'whatsapp_invalido' | 'decisao_recusada';

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
  /** Decisões de etapa aplicadas nesta execução (AC-317). */
  decisoesAplicadas: number;
  /** Decisões "ignorar" aplicadas nesta execução (AC-317). */
  decisoesIgnoradas: number;
  /** Decisões que `validarDecisao` recusou nesta execução (AC-317). */
  decisoesRecusadas: number;
}

/** Acha a etapa automática pela situação do legado (AC-256/AC-257), ou `null` quando não há uma (AC-259) — o orquestrador usa isso para montar a fila de leads que esperam decisão. */
export function etapaDireta(situacao: string | null): number | null {
  if (!situacao || situacao === 'Novos Leads') return ETAPA_ENTRADA_DE_LEADS;
  if (situacao === 'Desqualificado') return ETAPA_PERDIDO;
  return null;
}

/** Registra o lead como ignorado (T-126) — sem FK, só para sair da fila de revisão de vez. */
async function registrarIgnorado(tx: TransacaoEtl, contexto: ContextoExecucao, idExterno: string): Promise<void> {
  await registrarMigracao(tx, contexto, {
    entidade: ENTIDADE_LEAD_IGNORADO,
    idExterno,
    idDestino: randomUUID(),
  });
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
 * `decisoes` (formato simples, mantido por compatibilidade) resolve, nesta
 * execução, leads que ficaram na fila de revisão em execuções anteriores
 * (AC-272) — serve só para etapas sem exigência, já que não carrega
 * `proximaAcaoEm`/`valor`/`motivoPerdaId`. `decisoesValidadas` (T-126,
 * US-089) é o caminho novo: o resultado já validado (`validarDecisao`,
 * T-124) da planilha de decisões comum, casado por `lead.id` — quem valida
 * é o orquestrador (T-113), que tem a tabela `etapas`, os motivos de perda e
 * o instante da execução; aqui só se aplica o resultado, exatamente como no
 * ETL do Sheets (T-125):
 *   - `etapa` cria o lead/card nessa etapa, com `proximaAcaoEm`/`valor`/
 *     `motivoPerdaId` da decisão (AC-315);
 *   - `ignorar` registra `lead_ignorado` e não cria nada;
 *   - `recusada` mantém o lead em revisão com o motivo.
 * Nenhuma das duas fontes de decisão se aplica quando a situação já resolve
 * a etapa sozinha (AC-256/AC-257).
 */
export async function migrarLeads(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  leadsLegado: LeadLegado[],
  decisoes: DecisaoRevisao[] = [],
  decisoesValidadas: Map<string, ResultadoValidacao> = new Map()
): Promise<ResultadoMigracaoLeads> {
  const etapaDecidida = new Map(decisoes.map((d) => [d.idExterno, d.etapaId]));

  let criadas = 0;
  let ignoradas = 0;
  let emRevisao = 0;
  let decisoesAplicadas = 0;
  let decisoesIgnoradas = 0;
  let decisoesRecusadas = 0;
  const revisao: ItemRevisao[] = [];

  for (const lead of leadsLegado) {
    const existente = await buscarIdDestino(tx, contexto.origem, lead.id);
    if (existente) {
      ignoradas++;
      continue;
    }

    let etapaId = etapaDireta(lead.situacao);
    let motivoPerdaId: string | undefined;
    let proximaAcaoEm: Date | undefined;
    let valor: number | undefined;

    if (etapaId === ETAPA_PERDIDO) {
      motivoPerdaId = await obterMotivoDesqualificadoMigracao(tx);
    }

    if (etapaId === null) {
      const decisaoValidada = decisoesValidadas.get(lead.id);
      if (decisaoValidada) {
        if (decisaoValidada.tipo === 'ignorar') {
          await registrarIgnorado(tx, contexto, lead.id);
          ignoradas++;
          decisoesIgnoradas++;
          continue;
        }
        if (decisaoValidada.tipo === 'recusada') {
          emRevisao++;
          decisoesRecusadas++;
          revisao.push({ idExterno: lead.id, tipo: 'decisao_recusada', motivo: decisaoValidada.motivo });
          continue;
        }
        etapaId = decisaoValidada.etapaId;
        motivoPerdaId = decisaoValidada.motivoPerdaId ?? motivoPerdaId;
        proximaAcaoEm = decisaoValidada.proximaAcaoEm;
        valor = decisaoValidada.valor;
        decisoesAplicadas++;
      } else {
        const decisaoSimples = etapaDecidida.get(lead.id);
        if (decisaoSimples === undefined) {
          emRevisao++;
          revisao.push({
            idExterno: lead.id,
            tipo: 'situacao_sem_etapa',
            motivo: `situação sem etapa automática: "${lead.situacao ?? ''}"`,
          });
          continue;
        }
        etapaId = decisaoSimples;
      }
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
        proximaAcaoEm: proximaAcaoEm ?? null,
        valor: valor !== undefined ? String(valor) : null,
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

  return {
    lidas: leadsLegado.length,
    criadas,
    ignoradas,
    emRevisao,
    revisao,
    decisoesAplicadas,
    decisoesIgnoradas,
    decisoesRecusadas,
  };
}

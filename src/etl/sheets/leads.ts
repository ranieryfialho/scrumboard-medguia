// T-118 (fase3-etl-sheets, US-078): grava cada lead deduplicado (T-116) como
// lead + card do pipeline novo, preservando os dados do formulário e a
// origem comercial da planilha (AC-284, AC-285), sempre na empresa dona das
// planilhas (AC-293). Reaproveita o contrato de `comum.ts`
// (`buscarIdDestino`/`registrarMigracao`) para idempotência em reexecução,
// com a entidade `lead` e `contexto.origem = 'sheets'` (mesmo mecanismo de
// `migracao_registros` usado por `fase3-etl-supabase`).
//
// Status (T-117) já decidido por quem chama: quando a decisão é `revisao`
// (AC-282/AC-283), nenhum lead nem card é criado aqui — a linha some do
// relatório de "criadas" e aparece em `revisao` (AC-292 é responsabilidade
// do orquestrador, T-120, mas a contagem nasce correta aqui).
//
// `dataFechamento` (AC-280) chega bruta do status.ts e nunca é reformatada
// lá — este módulo é quem decide onde ela entra: guardada (já normalizada
// para instante UTC) dentro do `dados` do lead, junto do resto do
// formulário, já que `oportunidades` não tem coluna própria para isso.
//
// T-125 (fase3-etl-decisoes, US-087): uma decisão já validada (`validarDecisao`,
// de `../decisoes`) para um `metaId` que está em revisão (AC-309) usa o MESMO
// caminho de criação de lead/card de um status automático — origem comercial,
// `dados` do formulário e evento `migrado_de` iguais — só a etapa, a próxima
// ação, o valor e o motivo de perda vêm da decisão em vez do mapa de status
// (AC-310: "Follow de longo prazo" grava `proximaAcaoEm` no card). `ignorar`
// (AC-311) registra o lead como `lead_ignorado` em `migracao_registros` — sem
// FK, só de controle (mesmo padrão de `fase3-etl-lp`) — para ele sair da fila
// de vez. Uma decisão `recusada` (validada por T-124) permanece em `revisao`
// com o motivo, sem abortar a execução (US-088).
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import type { ResultadoValidacao } from '../decisoes';
import { leads, motivosPerda, oportunidadeEventos, oportunidades } from '../../db/schema';
import type { LeadBruto } from './leitor';
import type { OrigemLead } from './dedupe';
import { normalizarData, normalizarTelefone } from './normalizar';
import type { ResultadoMapaStatus } from './status';

export const ENTIDADE_LEAD = 'lead';
/** Lead cuja decisão foi "ignorar" (AC-311) — registrado só para sair da fila, sem FK para nenhuma tabela de negócio. */
export const ENTIDADE_LEAD_IGNORADO = 'lead_ignorado';

/** Origem comercial por `planilha/aba` (AC-285) — mesmo mapa de `SHEET_KEY_ORIGEM_MAP` do legado (`src/app/api/sheets/route.ts`). */
export const ORIGEM_COMERCIAL_POR_ABA: Record<string, string> = {
  'sheet1/Página1': 'BM MedGuia',
  'sheet1/Página2': 'BM Dr. Felipe',
  'sheet2/Página1': 'BM Dr. Felipe',
  'sheet3/Página1': 'BM MedGuia',
};

/** Decide a origem comercial a partir da planilha/aba (AC-285). Aba fora do mapa devolve `undefined` — nunca inventa um rótulo. */
export function obterOrigemComercial(origem: OrigemLead): string | undefined {
  return ORIGEM_COMERCIAL_POR_ABA[`${origem.planilha}/${origem.aba}`];
}

/** Respostas do formulário e observações preservadas no lead (AC-284). */
export interface DadosFormularioLead {
  especialidade?: string;
  crm?: string;
  anuncio?: string;
  campanha?: string;
  formulario?: string;
  plataforma?: string;
  observacoes?: string;
  dataFechamento?: string;
}

function campo(camposExtras: Record<string, string>, ...chaves: string[]): string | undefined {
  for (const chave of chaves) {
    const valor = camposExtras[chave];
    if (valor && valor.trim()) return valor;
  }
  return undefined;
}

/**
 * Extrai especialidade, CRM, anúncio, campanha, formulário, plataforma e
 * observações do lead bruto (AC-284). `dataFechamento`, quando presente na
 * decisão de status (AC-280), é normalizada para o instante UTC e guardada
 * junto — nunca a string bruta da planilha.
 */
export function extrairDadosFormulario(
  lead: LeadBruto,
  decisao?: ResultadoMapaStatus
): DadosFormularioLead {
  const campos = lead.camposExtras;
  const dados: DadosFormularioLead = {
    especialidade: lead.especialidade || undefined,
    crm: campo(campos, 'qual_o_numero_do_seu_crm?', 'qual_o_numero_do_seu_crm', 'crm'),
    anuncio: campo(campos, 'ad_name', 'nome_do_anuncio'),
    campanha: campo(campos, 'campaign_name', 'utm_campaign', 'campanha'),
    formulario: campo(campos, 'form_name', 'formulario', 'nome_do_formulario'),
    plataforma: campo(campos, 'platform', 'plataforma'),
    observacoes: campo(campos, 'observacoes', 'observacao'),
  };

  if (decisao?.tipo === 'etapa' && decisao.dataFechamento) {
    dados.dataFechamento = normalizarData(decisao.dataFechamento);
  }

  return dados;
}

function dadosSemVazios(dados: DadosFormularioLead): Record<string, string> | null {
  const entradas = Object.entries(dados).filter(
    (par): par is [string, string] => typeof par[1] === 'string' && par[1].trim() !== ''
  );
  if (entradas.length === 0) return null;
  return Object.fromEntries(entradas);
}

export interface LeadParaImportar {
  lead: LeadBruto;
  origem: OrigemLead;
  decisao: ResultadoMapaStatus;
}

/** `decisao_recusada` (AC-312/AC-313/AC-314): a planilha de decisões trazia algo para este `metaId`, mas `validarDecisao` recusou — volta para a revisão com o motivo, sem abortar a execução. */
export type TipoItemRevisaoLead = 'status_em_revisao' | 'decisao_recusada';

/** Item da fila de revisão (AC-307): carrega os dados descritivos do lead para a planilha gerada por `gerarCsvFilaRevisao`. */
export interface ItemRevisaoLead {
  metaId: string;
  tipo: TipoItemRevisaoLead;
  motivo: string;
  nome: string;
  telefone: string;
  email: string;
  statusOriginal: string;
}

export interface ResultadoImportacaoLeads {
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
  revisao: ItemRevisaoLead[];
  /** Decisões de etapa aplicadas nesta execução (AC-317). */
  decisoesAplicadas: number;
  /** Decisões "ignorar" aplicadas nesta execução (AC-317). */
  decisoesIgnoradas: number;
  /** Decisões que `validarDecisao` recusou nesta execução (AC-317). */
  decisoesRecusadas: number;
}

function itemRevisao(lead: LeadBruto, tipo: TipoItemRevisaoLead, motivo: string): ItemRevisaoLead {
  return {
    metaId: lead.metaId,
    tipo,
    motivo,
    nome: lead.nome,
    telefone: lead.telefone,
    email: lead.email,
    statusOriginal: lead.situacaoBruta,
  };
}

async function obterOuCriarMotivoPerda(tx: TransacaoEtl, nome: string): Promise<string> {
  const [existente] = await tx.select({ id: motivosPerda.id }).from(motivosPerda).where(eq(motivosPerda.nome, nome));
  if (existente) return existente.id;

  const [criado] = await tx
    .insert(motivosPerda)
    .values({ nome, ativo: true, eSistemico: true })
    .returning({ id: motivosPerda.id });
  return criado.id;
}

/** Registra o lead como ignorado (AC-311) — sem FK, só para sair da fila de revisão de vez. */
async function registrarIgnorado(tx: TransacaoEtl, contexto: ContextoExecucao, metaId: string): Promise<void> {
  await registrarMigracao(tx, contexto, {
    entidade: ENTIDADE_LEAD_IGNORADO,
    idExterno: metaId,
    idDestino: randomUUID(),
  });
}

interface CriacaoLeadECard {
  lead: LeadBruto;
  origem: OrigemLead;
  etapaId: number;
  motivoPerdaId?: string;
  proximaAcaoEm?: Date;
  valor?: number;
}

/**
 * Cria lead + card + evento `migrado_de` e registra a migração (AC-284,
 * AC-285, AC-309) — mesmo caminho para um lead decidido pela status.ts
 * (`decisaoStatus` presente, para `dataFechamento`) ou pela planilha de
 * decisões (AC-310: `proximaAcaoEm`/`valor`/`motivoPerdaId` vêm da decisão).
 */
async function criarLeadECard(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  criacao: CriacaoLeadECard,
  decisaoStatus?: ResultadoMapaStatus
): Promise<void> {
  const { lead, origem, etapaId, motivoPerdaId, proximaAcaoEm, valor } = criacao;

  const telefoneE164 = normalizarTelefone(lead.telefone) ?? null;
  const dadosFormulario = dadosSemVazios(extrairDadosFormulario(lead, decisaoStatus));

  const [novoLead] = await tx
    .insert(leads)
    .values({
      empresaId,
      nome: lead.nome,
      email: lead.email || null,
      origem: obterOrigemComercial(origem) ?? null,
      telefoneE164,
      idExterno: lead.metaId,
      dados: dadosFormulario,
    })
    .returning();

  const [novaOportunidade] = await tx
    .insert(oportunidades)
    .values({
      empresaId,
      leadId: novoLead.id,
      etapaId,
      motivoPerdaId: motivoPerdaId ?? null,
      proximaAcaoEm: proximaAcaoEm ?? null,
      valor: valor !== undefined ? String(valor) : null,
    })
    .returning();

  await tx.insert(oportunidadeEventos).values({
    empresaId,
    oportunidadeId: novaOportunidade.id,
    tipo: 'migrado_de',
    atorTipo: 'migracao',
    payload: { planilha: origem.planilha, aba: origem.aba, idExterno: lead.metaId },
  });

  await registrarMigracao(tx, contexto, {
    entidade: ENTIDADE_LEAD,
    idExterno: lead.metaId,
    idDestino: novoLead.id,
  });
}

/**
 * Grava cada lead deduplicado como lead + card, sempre na empresa dona das
 * planilhas (AC-293), com a origem comercial da planilha (AC-285) e um
 * evento `migrado_de` guardando planilha, aba e id da Meta (AC-285).
 * Idempotente via `migracao_registros` (entidade `lead` ou `lead_ignorado`,
 * origem `contexto.origem`) — reexecução sobre o mesmo `metaId` apenas
 * ignora, seja ele criado ou marcado como ignorado (AC-311).
 *
 * `decisoes` (T-125, US-087) traz, por `metaId`, o resultado já validado
 * (`validarDecisao`, T-124) da planilha de decisões para os leads que esta
 * execução colocaria em revisão — quem casa a linha da planilha com o lead e
 * roda a validação é o orquestrador (T-120), que tem a tabela `etapas` e o
 * instante da execução; aqui só se aplica o resultado:
 *   - `etapa` cria o lead/card nessa etapa, com `proximaAcaoEm`/`valor`/
 *     `motivoPerdaId` da decisão (AC-309, AC-310);
 *   - `ignorar` registra `lead_ignorado` e não cria nada (AC-311);
 *   - `recusada` mantém o lead em revisão com o motivo (AC-312 a AC-314).
 * Sem decisão para o `metaId`, o lead segue o caminho original: cria pela
 * etapa automática ou entra em revisão (AC-282/AC-283).
 */
export async function importarLeadsSheets(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  entradas: LeadParaImportar[],
  decisoes: Map<string, ResultadoValidacao> = new Map()
): Promise<ResultadoImportacaoLeads> {
  let criadas = 0;
  let ignoradas = 0;
  let emRevisao = 0;
  let decisoesAplicadas = 0;
  let decisoesIgnoradas = 0;
  let decisoesRecusadas = 0;
  const revisao: ItemRevisaoLead[] = [];

  for (const entrada of entradas) {
    const { lead, origem, decisao } = entrada;

    const existente = await buscarIdDestino(tx, contexto.origem, lead.metaId);
    if (existente) {
      ignoradas++;
      continue;
    }

    const decisaoValidada = decisoes.get(lead.metaId);
    if (decisaoValidada) {
      if (decisaoValidada.tipo === 'ignorar') {
        await registrarIgnorado(tx, contexto, lead.metaId);
        ignoradas++;
        decisoesIgnoradas++;
        continue;
      }

      if (decisaoValidada.tipo === 'recusada') {
        emRevisao++;
        decisoesRecusadas++;
        revisao.push(itemRevisao(lead, 'decisao_recusada', decisaoValidada.motivo));
        continue;
      }

      await criarLeadECard(tx, contexto, empresaId, {
        lead,
        origem,
        etapaId: decisaoValidada.etapaId,
        motivoPerdaId: decisaoValidada.motivoPerdaId,
        proximaAcaoEm: decisaoValidada.proximaAcaoEm,
        valor: decisaoValidada.valor,
      });
      criadas++;
      decisoesAplicadas++;
      continue;
    }

    if (decisao.tipo === 'revisao') {
      emRevisao++;
      revisao.push(itemRevisao(lead, 'status_em_revisao', decisao.motivo));
      continue;
    }

    let motivoPerdaId: string | undefined;
    if (decisao.motivoPerdaNome) {
      motivoPerdaId = await obterOuCriarMotivoPerda(tx, decisao.motivoPerdaNome);
    }

    await criarLeadECard(tx, contexto, empresaId, { lead, origem, etapaId: decisao.etapaId, motivoPerdaId }, decisao);
    criadas++;
  }

  return {
    lidas: entradas.length,
    criadas,
    ignoradas,
    emRevisao,
    revisao,
    decisoesAplicadas,
    decisoesIgnoradas,
    decisoesRecusadas,
  };
}

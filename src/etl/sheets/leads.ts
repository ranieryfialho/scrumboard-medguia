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
import { eq } from 'drizzle-orm';

import { buscarIdDestino, registrarMigracao, type ContextoExecucao, type TransacaoEtl } from '../comum';
import { leads, motivosPerda, oportunidadeEventos, oportunidades } from '../../db/schema';
import type { LeadBruto } from './leitor';
import type { OrigemLead } from './dedupe';
import { normalizarData, normalizarTelefone } from './normalizar';
import type { ResultadoMapaStatus } from './status';

export const ENTIDADE_LEAD = 'lead';

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

export type TipoItemRevisaoLead = 'status_em_revisao';

export interface ItemRevisaoLead {
  metaId: string;
  tipo: TipoItemRevisaoLead;
  motivo: string;
}

export interface ResultadoImportacaoLeads {
  lidas: number;
  criadas: number;
  ignoradas: number;
  emRevisao: number;
  revisao: ItemRevisaoLead[];
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

/**
 * Grava cada lead deduplicado como lead + card, sempre na empresa dona das
 * planilhas (AC-293), com a origem comercial da planilha (AC-285) e um
 * evento `migrado_de` guardando planilha, aba e id da Meta (AC-285).
 * Idempotente via `migracao_registros` (entidade `lead`, origem
 * `contexto.origem`) — reexecução sobre o mesmo `metaId` apenas ignora.
 */
export async function importarLeadsSheets(
  tx: TransacaoEtl,
  contexto: ContextoExecucao,
  empresaId: string,
  entradas: LeadParaImportar[]
): Promise<ResultadoImportacaoLeads> {
  let criadas = 0;
  let ignoradas = 0;
  let emRevisao = 0;
  const revisao: ItemRevisaoLead[] = [];

  for (const entrada of entradas) {
    const { lead, origem, decisao } = entrada;

    const existente = await buscarIdDestino(tx, contexto.origem, lead.metaId);
    if (existente) {
      ignoradas++;
      continue;
    }

    if (decisao.tipo === 'revisao') {
      emRevisao++;
      revisao.push({ metaId: lead.metaId, tipo: 'status_em_revisao', motivo: decisao.motivo });
      continue;
    }

    const telefoneE164 = normalizarTelefone(lead.telefone) ?? null;
    const dadosFormulario = dadosSemVazios(extrairDadosFormulario(lead, decisao));

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

    let motivoPerdaId: string | undefined;
    if (decisao.motivoPerdaNome) {
      motivoPerdaId = await obterOuCriarMotivoPerda(tx, decisao.motivoPerdaNome);
    }

    const [novaOportunidade] = await tx
      .insert(oportunidades)
      .values({
        empresaId,
        leadId: novoLead.id,
        etapaId: decisao.etapaId,
        motivoPerdaId: motivoPerdaId ?? null,
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

    criadas++;
  }

  return { lidas: entradas.length, criadas, ignoradas, emRevisao, revisao };
}

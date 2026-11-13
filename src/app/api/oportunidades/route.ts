// T-046 (fase2-kanban, US-029/US-030): rota do board (`GET`) e criação manual
// de card (`POST`). Primeira rota HTTP da stack Drizzle/Postgres própria
// (T-020+) — os repositórios (`listarOportunidades`, `criarOportunidade`,
// fase1) e `resolverContextoTenant` (fase1-auth-rbac) já existiam; esta rota
// só os compõe.
//
// Sessão: `auth.api.getSession` (Better Auth) verifica a assinatura do
// cookie e devolve o token puro que casa com `sessoes.token` — só então
// `resolverContextoTenant` decide se a sessão ainda é válida (AC-078). Sem
// isso, o cookie bruto que chega no header `Cookie` vem com a assinatura
// HMAC concatenada (`token.assinatura`) e nunca bateria com `sessoes.token`.
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { leads, pipelineEtapas, pipelineTransicoes, usuarios } from '../../../db/schema';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { papelPodeTransicionar } from '../../../domain/pipeline/papel';
import type { FaixaDeQualificacao } from '../../../domain/qualificacao/qualificacao';
import { comTenant } from '../../../repositories/contexto';
import { obterProximasAcoesDosCards } from '../../../repositories/proxima-acao-card';
import type { ProximaAcao } from '../../../domain/pipeline/proxima-acao';
import { lerResumosDeQualificacao } from '../../../repositories/qualificacao';
import { criarOportunidade, ErroLeadNaoEncontrado, listarOportunidades } from '../../../repositories/oportunidades';
import {
  criarLeadComOportunidade,
  ErroCampoObrigatorio,
  ErroResponsavelInvalido,
} from '../../../repositories/oportunidades-novo-lead';

export const dynamic = 'force-dynamic';

/** AC-078: resolve o `ContextoTenant` da requisição, ou `null` sem tocar em nenhuma tabela de negócio. */
async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

/**
 * AC-094: para cada uma das 15 etapas, os ids de destino alcançáveis pelo
 * papel do ator — mesma regra de `papelPodeTransicionar` (fase1-dominio-pipeline),
 * aplicada em memória sobre o grafo já carregado (não duplica a regra, só a
 * consulta).
 */
async function carregarGrafoAlcancavel(contexto: ContextoTenant): Promise<Record<number, number[]>> {
  const db = getDb();
  const [etapas, transicoes] = await Promise.all([
    db.select({ id: pipelineEtapas.id }).from(pipelineEtapas),
    db
      .select({
        etapaOrigemId: pipelineTransicoes.etapaOrigemId,
        etapaDestinoId: pipelineTransicoes.etapaDestinoId,
        papeisPermitidos: pipelineTransicoes.papeisPermitidos,
      })
      .from(pipelineTransicoes),
  ]);

  const grafo: Record<number, number[]> = {};
  for (const etapa of etapas) {
    grafo[etapa.id] = [];
  }
  for (const transicao of transicoes) {
    if (papelPodeTransicionar(transicao.papeisPermitidos, contexto)) {
      grafo[transicao.etapaOrigemId]?.push(transicao.etapaDestinoId);
    }
  }
  return grafo;
}

export interface CardBoard {
  id: string;
  etapaId: number;
  leadId: string;
  leadNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  valor: string | null;
  version: number;
  /** Quando o card nasceu — base da ordem (mais novo primeiro) e do selo "Novo" da Entrada de leads. */
  criadoEm: string;
  /** fase6-qualificacao-comercial (AC-834): faixa e nota da qualificação; `null` quando o card não foi avaliado. */
  qualificacao: { faixa: FaixaDeQualificacao; score: number } | null;
  /** A próxima ação conforme a etapa (reunião, toque da cadência, data combinada). */
  proximaAcao: ProximaAcao;
}

/** AC-075: enriquece a página de `listarOportunidades` com nome do lead e do responsável. */
async function enriquecerCards(
  contexto: ContextoTenant,
  itens: Awaited<ReturnType<typeof listarOportunidades>>['itens']
): Promise<CardBoard[]> {
  if (itens.length === 0) return [];

  const leadIds = [...new Set(itens.map((o) => o.leadId))];
  const responsavelIds = [...new Set(itens.map((o) => o.responsavelId).filter((id): id is string => id !== null))];

  const qualificacoes = await lerResumosDeQualificacao(getDb(), contexto, itens.map((o) => o.id));
  const proximasAcoes = await obterProximasAcoesDosCards(getDb(), contexto, itens, new Date());
  const [leadsEncontrados, responsaveisEncontrados] = await comTenant(getDb(), contexto, async (tx) => {
    const leadsEncontrados = await tx
      .select({ id: leads.id, nome: leads.nome })
      .from(leads)
      .where(and(inArray(leads.id, leadIds), eq(leads.empresaId, contexto.empresaId)));

    const responsaveisEncontrados =
      responsavelIds.length === 0
        ? []
        : await tx.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, responsavelIds));

    return [leadsEncontrados, responsaveisEncontrados] as const;
  });

  const nomeDoLead = new Map(leadsEncontrados.map((l) => [l.id, l.nome]));
  const nomeDoResponsavel = new Map(responsaveisEncontrados.map((u) => [u.id, u.nome]));

  return itens.map((o) => ({
    id: o.id,
    etapaId: o.etapaId,
    leadId: o.leadId,
    leadNome: nomeDoLead.get(o.leadId) ?? '',
    responsavelId: o.responsavelId,
    responsavelNome: o.responsavelId ? (nomeDoResponsavel.get(o.responsavelId) ?? null) : null,
    valor: o.valor,
    version: o.version,
    criadoEm: o.criadoEm.toISOString(),
    qualificacao: qualificacoes.get(o.id) ?? null,
    proximaAcao: proximasAcoes.get(o.id) as ProximaAcao,
  }));
}

/** AC-074/AC-075/AC-076/AC-077/AC-078/AC-094: board agrupável pelas 15 etapas. */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { searchParams } = new URL(request.url);
  const etapaIdParam = searchParams.get('etapaId');
  const responsavelIdParam = searchParams.get('responsavelId');

  const pagina = await listarOportunidades(getDb(), contexto, {
    etapaId: etapaIdParam !== null ? Number(etapaIdParam) : undefined,
    responsavelId: responsavelIdParam ?? undefined,
    limite: 1000,
  });

  const [itens, grafo] = await Promise.all([
    enriquecerCards(contexto, pagina.itens),
    carregarGrafoAlcancavel(contexto),
  ]);

  return NextResponse.json({ itens, grafo });
}

/**
 * T-165 (AC-391/AC-392): além de `{ leadId }` (lead já existente), aceita
 * `{ novoLead: { nome, telefone, email?, origem }, valor?, responsavelId? }`
 * — cria o lead e o card em "Entrada de leads" numa única transação. Quem
 * inicia a cadência depois ("Salvar e Iniciar Cadência") é o chamador,
 * encadeando `POST /api/oportunidades/[id]/cadencia/iniciar` já existente.
 */
function corpoComNovoLead(corpo: unknown): corpo is { novoLead: Record<string, unknown> } & Record<string, unknown> {
  if (!corpo || typeof corpo !== 'object') return false;
  const novoLead = (corpo as Record<string, unknown>).novoLead;
  return !!novoLead && typeof novoLead === 'object';
}

/** AC-079/AC-080/AC-081/AC-391/AC-392: cria um card a partir de um lead existente ou de um lead novo. */
export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const corpo = await request.json().catch(() => null);

  if (corpoComNovoLead(corpo)) {
    const novoLead = corpo.novoLead;
    try {
      const { lead, oportunidade } = await criarLeadComOportunidade(getDb(), contexto, {
        nome: novoLead.nome as string,
        telefone: novoLead.telefone as string,
        email: (novoLead.email as string | undefined) ?? null,
        origem: novoLead.origem as string,
        valor: (corpo.valor as string | undefined) ?? null,
        responsavelId: (corpo.responsavelId as string | undefined) ?? null,
      });
      return NextResponse.json({ ...oportunidade, leadId: lead.id }, { status: 201 });
    } catch (erro) {
      if (erro instanceof ErroCampoObrigatorio) {
        return NextResponse.json({ codigo: 'CAMPO_OBRIGATORIO', campo: erro.campo }, { status: 400 });
      }
      if (erro instanceof ErroResponsavelInvalido) {
        return NextResponse.json({ codigo: 'RESPONSAVEL_INVALIDO' }, { status: 400 });
      }
      throw erro;
    }
  }

  const leadId = corpo?.leadId;
  if (typeof leadId !== 'string' || leadId.length === 0) {
    return NextResponse.json({ codigo: 'LEAD_ID_OBRIGATORIO' }, { status: 400 });
  }

  try {
    const oportunidade = await criarOportunidade(getDb(), contexto, { leadId });
    return NextResponse.json(oportunidade, { status: 201 });
  } catch (erro) {
    if (erro instanceof ErroLeadNaoEncontrado) {
      return NextResponse.json({ codigo: 'LEAD_NAO_ENCONTRADO' }, { status: 422 });
    }
    throw erro;
  }
}

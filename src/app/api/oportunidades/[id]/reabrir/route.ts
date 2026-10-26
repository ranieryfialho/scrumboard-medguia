// T-156 (fase4-pipeline-telas, US-108, AC-404): rota POST
// /api/oportunidades/:id/reabrir — move um card arquivado de volta ao funil
// pela transição de reabertura já seedada (`14→5` e `15→13`,
// `exige_justificativa = true`, drizzle/0005_seeds.sql), reaproveitando o
// mesmo domínio (`validarTransicao`) e repositório (`moverOportunidade`) da
// rota `/transicao` (T-047) — a etapa de destino nunca vem do corpo da
// requisição, só do mapa de reabertura abaixo, então esta rota nunca move um
// card para outro lugar que não seja a reabertura do grafo.
//
// ASM-138/Q-048: o grafo seedado libera os três papéis em `14→5`/`15→13`
// (mesma transição usada por qualquer outra reabertura futura), mas a
// decisão do usuário (26/10) restringe "Reabrir" a MASTER e GERENTE — uma
// checagem por cima do grafo, sem mexer no seed. ATENDENTE recebe 403 antes
// de qualquer leitura no banco.
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { pipelineEtapas, pipelineTransicoes } from '../../../../../db/schema';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { validarTransicao } from '../../../../../domain/pipeline/validar-transicao';
import type { DadosTransicao, PipelineTransicao } from '../../../../../domain/pipeline/tipos';
import {
  buscarOportunidadePorId,
  ErroConflitoDeVersao,
  moverOportunidade,
} from '../../../../../repositories/oportunidades';

export const dynamic = 'force-dynamic';

const ETAPA_PERDIDO = 14;
const ETAPA_CONTRATO_GANHO = 15;

/** ASM-138: únicos destinos de "Reabrir" — Perdido volta a Qualificando, Ganho volta a Negociação. */
const ETAPA_REABERTURA: Record<number, number> = {
  [ETAPA_PERDIDO]: 5,
  [ETAPA_CONTRATO_GANHO]: 13,
};

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

function semPermissao() {
  return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
}

/** AC-404: só MASTER, GERENTE e super admin podem reabrir — restrição por cima do grafo (ASM-138). */
function podeReabrir(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

interface CorpoReabrir {
  version: number;
  justificativa?: string | null;
  proximaAcaoEm?: string | null;
}

function corpoValido(corpo: unknown): corpo is CorpoReabrir {
  if (!corpo || typeof corpo !== 'object') return false;
  const { version } = corpo as Record<string, unknown>;
  return typeof version === 'number';
}

/** AC-404: reabre um card arquivado, respeitando grafo, papel e dados obrigatórios da etapa de destino. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeReabrir(contexto)) return semPermissao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const oportunidade = await buscarOportunidadePorId(getDb(), contexto, id);
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  const etapaDestinoId = ETAPA_REABERTURA[oportunidade.etapaId];
  if (etapaDestinoId === undefined) {
    return NextResponse.json({ codigo: 'TRANSICAO_NAO_PERMITIDA' }, { status: 422 });
  }

  const db = getDb();
  const [etapaDestino] = await db
    .select()
    .from(pipelineEtapas)
    .where(eq(pipelineEtapas.id, etapaDestinoId))
    .limit(1);

  const transicoesDaOrigem: PipelineTransicao[] = await db
    .select({
      etapaOrigemId: pipelineTransicoes.etapaOrigemId,
      etapaDestinoId: pipelineTransicoes.etapaDestinoId,
      exigeJustificativa: pipelineTransicoes.exigeJustificativa,
      papeisPermitidos: pipelineTransicoes.papeisPermitidos,
    })
    .from(pipelineTransicoes)
    .where(eq(pipelineTransicoes.etapaOrigemId, oportunidade.etapaId));

  const dados: DadosTransicao = {
    valor: null,
    motivoPerdaId: null,
    proximaAcaoEm: corpo.proximaAcaoEm ? new Date(corpo.proximaAcaoEm) : null,
    anexoId: null,
    justificativa: corpo.justificativa ?? null,
  };

  const resultado = validarTransicao({
    transicoes: transicoesDaOrigem,
    etapaOrigemId: oportunidade.etapaId,
    etapaDestino,
    ator: { papel: contexto.papel, isSuperAdmin: contexto.isSuperAdmin },
    dados,
  });

  if (!resultado.ok) {
    return NextResponse.json({ codigo: resultado.erro }, { status: 422 });
  }

  try {
    const reaberta = await moverOportunidade(db, contexto, id, {
      version: corpo.version,
      etapaDestinoId,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      proximaAcaoEm: dados.proximaAcaoEm,
    });
    return NextResponse.json(reaberta);
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) {
      return NextResponse.json({ codigo: 'CONFLITO_DE_VERSAO' }, { status: 409 });
    }
    throw erro;
  }
}

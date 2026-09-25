// T-047 (fase2-kanban, US-031): única rota que move um card de etapa. Fluxo:
// resolve sessão (401) → busca o card no tenant (404 se não existir — AC-087,
// fail closed, antes de validar qualquer coisa) → carrega etapa destino e o
// recorte do grafo a partir da etapa de origem → `validarTransicao`
// (domínio, síncrono; fase1-dominio-pipeline) → se `!ok`, 422 com o `codigo`
// do domínio, sem tocar a escrita → se `ok`, `moverOportunidade` (fase2,
// T-045), que grava tudo atomicamente; conflito de versão (lock otimista)
// vira 409 (ASM-021).
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { pipelineEtapas, pipelineTransicoes } from '../../../../../db/schema';
import { criarAuth } from '../../../../../lib/auth/server';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { validarTransicao } from '../../../../../domain/pipeline/validar-transicao';
import type { DadosTransicao, PipelineTransicao } from '../../../../../domain/pipeline/tipos';
import {
  buscarOportunidadePorId,
  ErroConflitoDeVersao,
  moverOportunidade,
} from '../../../../../repositories/oportunidades';

const auth = criarAuth(getDb(), {
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});

/** AC-078 (mesmo padrão da rota do board): resolve o `ContextoTenant`, ou `null` sem tocar em nenhuma tabela de negócio. */
async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await auth.api.getSession({ headers: request.headers });
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

interface CorpoTransicao {
  version: number;
  etapaDestinoId: number;
  valor?: number | null;
  motivoPerdaId?: string | null;
  proximaAcaoEm?: string | null;
  anexoId?: string | null;
  justificativa?: string | null;
}

function corpoValido(corpo: unknown): corpo is CorpoTransicao {
  if (!corpo || typeof corpo !== 'object') return false;
  const { version, etapaDestinoId } = corpo as Record<string, unknown>;
  return typeof version === 'number' && typeof etapaDestinoId === 'number';
}

/** AC-082 a AC-087: move o card respeitando grafo, papel e dados obrigatórios da etapa de destino. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  // AC-087: card de outro tenant (ou inexistente) "não existe" do ponto de
  // vista do chamador — 404 antes de validar a transição, nunca 403.
  const oportunidade = await buscarOportunidadePorId(getDb(), contexto, id);
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  const db = getDb();
  const [etapaDestino] = await db
    .select()
    .from(pipelineEtapas)
    .where(eq(pipelineEtapas.id, corpo.etapaDestinoId))
    .limit(1);

  // Destino fora das 15 etapas conhecidas nunca tem linha em
  // `pipeline_transicoes` — mesmo desfecho de "fora do grafo" (AC-083), sem
  // precisar montar um `PipelineEtapa` inexistente pro domínio.
  if (!etapaDestino) {
    return NextResponse.json({ codigo: 'TRANSICAO_NAO_PERMITIDA' }, { status: 422 });
  }

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
    valor: corpo.valor ?? null,
    motivoPerdaId: corpo.motivoPerdaId ?? null,
    proximaAcaoEm: corpo.proximaAcaoEm ? new Date(corpo.proximaAcaoEm) : null,
    anexoId: corpo.anexoId ?? null,
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
    const movida = await moverOportunidade(db, contexto, id, {
      version: corpo.version,
      etapaDestinoId: corpo.etapaDestinoId,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      valor: typeof corpo.valor === 'number' ? String(corpo.valor) : null,
      motivoPerdaId: corpo.motivoPerdaId ?? null,
      proximaAcaoEm: dados.proximaAcaoEm,
    });
    return NextResponse.json(movida);
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) {
      return NextResponse.json({ codigo: 'CONFLITO_DE_VERSAO' }, { status: 409 });
    }
    throw erro;
  }
}

// T-091 (fase2b-cadencia, US-053): rota que inicia a cadência de 18 toques
// de um card. Mesmo padrão de sessão/tenant/versão da rota de transição
// (src/app/api/oportunidades/[id]/transicao/route.ts): 401 sem sessão → 404
// se o card não existir no tenant (fail closed, antes de tocar em qualquer
// escrita) → 409 se a `version` do corpo não bater com a atual (AC-191).
// A escrita em si (etapa, `cadencia_dia`/`cadencia_turno`, os 3 toques do
// primeiro bloco e o evento `cadencia_iniciada`) é toda da função SQL
// `iniciar_cadencia` (T-089), chamada por `iniciarCadencia` (T-090) — esta
// rota só traduz request/response (AC-190).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../../db/client';
import { getAuth } from '../../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../../lib/auth/tenant';
import { buscarOportunidadePorId } from '../../../../../../repositories/oportunidades';
import { ErroConflitoDeVersao, iniciarCadencia } from '../../../../../../repositories/cadencia';

export const dynamic = 'force-dynamic';

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

interface CorpoIniciarCadencia {
  version: number;
}

function corpoValido(corpo: unknown): corpo is CorpoIniciarCadencia {
  if (!corpo || typeof corpo !== 'object') return false;
  const { version } = corpo as Record<string, unknown>;
  return typeof version === 'number';
}

/** AC-190/AC-191: inicia a cadência (dia 1, manhã) com exatamente 3 toques pendentes, respeitando versão, tenant e sessão. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const db = getDb();

  // AC-191: card de outro tenant (ou inexistente) "não existe" do ponto de
  // vista do chamador — 404 antes de chamar a função SQL, nunca 403.
  const oportunidade = await buscarOportunidadePorId(db, contexto, id);
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  try {
    const resultado = await iniciarCadencia(db, contexto, id, {
      version: corpo.version,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
    });
    return NextResponse.json(resultado);
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) {
      return NextResponse.json({ codigo: 'CONFLITO_DE_VERSAO' }, { status: 409 });
    }
    throw erro;
  }
}

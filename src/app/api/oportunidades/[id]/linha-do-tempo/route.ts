// T-157 (fase4-pipeline-telas, US-109): rota GET
// /api/oportunidades/:id/linha-do-tempo — "Linha de Tempo de Atividades" do
// detalhe do card (AC-408), usando `listarLinhaDoTempo` (T-157). Mesmo
// padrão de sessão/tenant das demais rotas de `/api/oportunidades` (401
// antes de tocar no banco; card de outro tenant ou inexistente é 404,
// fail-closed, igual a anotacoes/route.ts — AC-412).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { listarLinhaDoTempo } from '../../../../../repositories/linha-do-tempo';
import { buscarOportunidadePorId } from '../../../../../repositories/oportunidades';

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

function oportunidadeNaoEncontrada() {
  return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
}

function paginaDaQuery(valor: string | null): number | undefined {
  if (!valor) return undefined;
  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : undefined;
}

/** AC-408: eventos do card do mais novo ao mais antigo, com tipo, texto, autor, data e a contagem de interações. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const oportunidade = await buscarOportunidadePorId(getDb(), contexto, id);
  if (!oportunidade) return oportunidadeNaoEncontrada();

  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get('tipo') || undefined;
  const pagina = paginaDaQuery(searchParams.get('pagina'));

  const resultado = await listarLinhaDoTempo(getDb(), contexto, id, { tipo, pagina });

  return NextResponse.json({
    itens: resultado.itens.map((item) => ({
      id: item.id,
      tipo: item.tipo,
      texto: item.texto,
      autorNome: item.autorNome,
      ocorridoEm: item.ocorridoEm.toISOString(),
    })),
    totalInteracoes: resultado.totalInteracoes,
    pagina: resultado.pagina,
    porPagina: resultado.porPagina,
  });
}

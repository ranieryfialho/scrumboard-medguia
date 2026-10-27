// T-156 (fase4-pipeline-telas, US-109): rota POST
// /api/oportunidades/:id/anotacoes — registra uma anotação interna (bloco
// "Registrar Interação Rápida" do detalhe, AC-409) usando `registrarAnotacao`
// (T-156). Mesmo padrão de sessão/tenant das demais rotas de
// `/api/oportunidades` (401 antes de tocar no banco; card de outro tenant ou
// inexistente é 404, fail-closed, igual a transicao/route.ts).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { registrarAnotacao } from '../../../../../repositories/anotacoes';
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

/** AC-409: texto vazio (ou só espaços) nunca chega a gravar evento. */
function textoValido(corpo: unknown): corpo is { texto: string } {
  if (!corpo || typeof corpo !== 'object') return false;
  const { texto } = corpo as Record<string, unknown>;
  return typeof texto === 'string' && texto.trim().length > 0;
}

/** AC-409: registra a anotação interna na linha do tempo do card. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!textoValido(corpo)) {
    return NextResponse.json({ codigo: 'TEXTO_OBRIGATORIO' }, { status: 400 });
  }

  const oportunidade = await buscarOportunidadePorId(getDb(), contexto, id);
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  const anotacao = await registrarAnotacao(getDb(), contexto, id, { texto: corpo.texto.trim() });

  return NextResponse.json(
    {
      id: anotacao.id,
      texto: anotacao.texto,
      autorId: anotacao.autorId,
      autorNome: anotacao.autorNome,
      ocorridoEm: anotacao.ocorridoEm.toISOString(),
    },
    { status: 201 }
  );
}

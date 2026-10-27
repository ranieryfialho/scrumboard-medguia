// T-169 (fase4-card-abas, US-112): GET /api/oportunidades/:id/anexos —
// lista os anexos do card (aba "Anexos & Evidências", tela 12). Mesmo
// padrão de sessão e tenant das demais rotas de `/api/oportunidades` (401
// antes de tocar no banco; card de outra empresa ou inexistente é 404,
// fail-closed, igual a transicao/route.ts e anotacoes/route.ts).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { listarAnexosDoCard } from '../../../../../repositories/anexos-lista';
import { buscarOportunidadePorId } from '../../../../../repositories/oportunidades';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** AC-423/AC-424: lista os anexos do card, só os da empresa da sessão. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const db = getDb();
  // `id` que nem é uuid nunca existe — mesmo 404 de card alheio.
  const oportunidade = UUID.test(id) ? await buscarOportunidadePorId(db, contexto, id) : null;
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  const anexos = await listarAnexosDoCard(db, contexto, id);

  return NextResponse.json({
    anexos: anexos.map((anexo) => ({
      id: anexo.id,
      nome: anexo.nome,
      mime: anexo.mime,
      tamanho: anexo.tamanho,
      hash: anexo.hash,
      enviadoPorNome: anexo.enviadoPorNome,
      criadoEm: anexo.criadoEm.toISOString(),
      evidencia: anexo.evidencia,
    })),
  });
}

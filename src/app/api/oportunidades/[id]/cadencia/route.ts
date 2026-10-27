// T-170 (fase4-card-abas, US-113): GET /api/oportunidades/:id/cadencia — os 18
// toques da cadência do card (aba "Cadência", tela 10). Mesmo padrão de sessão
// e tenant das demais rotas de `/api/oportunidades` (401 antes de tocar no
// banco; card de outra empresa ou inexistente é 404, fail-closed). Irmã de
// `cadencia/iniciar/route.ts`.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { obterCadenciaDoCard } from '../../../../../repositories/cadencia-card';

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

/** AC-430/AC-431: os toques do card, só da empresa da sessão. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  // `id` que nem é uuid nunca existe — mesmo 404 de card alheio.
  const cadencia = UUID.test(id) ? await obterCadenciaDoCard(getDb(), contexto, id, new Date()) : null;
  if (!cadencia) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  return NextResponse.json({
    ...cadencia,
    toques: cadencia.toques.map((toque) => ({
      ...toque,
      realizadaEm: toque.realizadaEm ? toque.realizadaEm.toISOString() : null,
    })),
    toqueDaVez: cadencia.toqueDaVez
      ? {
          ...cadencia.toqueDaVez,
          realizadaEm: cadencia.toqueDaVez.realizadaEm ? cadencia.toqueDaVez.realizadaEm.toISOString() : null,
        }
      : null,
  });
}

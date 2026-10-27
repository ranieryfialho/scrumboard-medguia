// T-177 (fase4-pipeline-lote, US-116): GET /api/pipeline/responsaveis — usuários
// ATIVOS da empresa da sessão (id, nome e papel), para o seletor de "Reatribuir
// Comercial". A `/api/usuarios` que já existe é do legado em Supabase e não
// serve aqui. Qualquer usuário logado lê (os nomes já aparecem nos cards).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { listarResponsaveisAtivos } from '../../../../repositories/lote-reatribuicao';

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

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  return NextResponse.json({ responsaveis: await listarResponsaveisAtivos(getDb(), contexto) });
}

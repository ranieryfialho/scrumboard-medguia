// T-056 (fase2c-anexos, US-035): GET /api/anexos/:id — com sessão, checa que o
// anexo é do tenant (404 se não, AC-102) e redireciona (302) para a URL
// assinada de 60 s (AC-101). Quem serve os bytes é /api/anexos/arquivo/:id.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { assinarUrl } from '../../../../lib/anexos/assinatura';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buscarAnexoPorId } from '../../../../repositories/anexos';

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  // `id` que nem é uuid nunca existe — mesmo 404 de anexo alheio.
  const anexo = UUID.test(id) ? await buscarAnexoPorId(getDb(), contexto, id) : null;
  if (!anexo) return NextResponse.json({ codigo: 'ANEXO_NAO_ENCONTRADO' }, { status: 404 });

  const { url } = assinarUrl(anexo.id, anexo.empresaId);
  const resposta = NextResponse.redirect(new URL(url, request.url), 302);
  resposta.headers.set('Cache-Control', 'no-store');
  return resposta;
}

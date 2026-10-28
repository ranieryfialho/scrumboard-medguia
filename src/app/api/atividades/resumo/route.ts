// T-181 (fase4-tarefas-agenda, AC-462/AC-463): indicadores da fila do turno e
// das atrasadas. Mesmo padrão de sessão/tenant da fila (401 sem sessão).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { resumoDoTurno } from '../../../../repositories/resumo-turno';

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

function podeVerTodoTenant(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  let responsavelId: string | undefined;
  if (!podeVerTodoTenant(contexto)) responsavelId = contexto.usuarioId;
  else {
    const pedido = request.nextUrl.searchParams.get('responsavelId');
    if (pedido && /^[0-9a-f-]{36}$/i.test(pedido)) responsavelId = pedido;
  }

  const resumo = await resumoDoTurno(getDb(), contexto, { responsavelId, agora: new Date() });
  return NextResponse.json(resumo);
}

// T-184 (fase4-tarefas-agenda, AC-483/AC-487): indicadores da agenda, fila de
// resgate de no-shows e desempenho por closer. 401 sem sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { resumoDaAgenda } from '../../../../repositories/reunioes';

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

  const todos = contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
  const resumo = await resumoDaAgenda(getDb(), contexto, {
    somenteResponsavelId: todos ? undefined : contexto.usuarioId,
    agora: new Date(),
  });
  return NextResponse.json(resumo);
}

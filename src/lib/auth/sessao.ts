// T-247 (fase5-whatsapp-lote-base): o contexto da sessão para rotas que só exigem estar logado (qualquer papel);
// sem sessão válida devolve `null` e a rota responde 401.
import type { NextRequest } from 'next/server';

import { getDb } from '../../db/client';
import { getAuth } from './instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from './tenant';

export async function contextoDaSessao(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;
  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

export const ehGestor = (contexto: ContextoTenant): boolean => contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';

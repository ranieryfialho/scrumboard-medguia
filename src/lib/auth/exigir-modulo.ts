// Guarda das rotas de API de um módulo: sessão (401) e módulo liberado (403). Quem acessa é decidido pelos módulos liberados da pessoa
// (`modulos.ts`): gerente e master têm por padrão, os demais só se alguém liberar. Devolve o contexto do tenant.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../db/client';
import { getAuth } from './instancia';
import { modulosEfetivos, type ModuloId } from './modulos';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from './tenant';

export function temModulo(contexto: Pick<ContextoTenant, 'isSuperAdmin' | 'papel' | 'modulos'>, modulo: ModuloId): boolean {
  return contexto.isSuperAdmin || modulosEfetivos(contexto.papel, false, contexto.modulos).has(modulo);
}

export async function exigirModulo(request: NextRequest, modulo: ModuloId): Promise<{ contexto: ContextoTenant } | { resposta: NextResponse }> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };
  let contexto: ContextoTenant;
  try {
    contexto = await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };
    throw erro;
  }
  if (!temModulo(contexto, modulo)) return { resposta: NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 }) };
  return { contexto };
}

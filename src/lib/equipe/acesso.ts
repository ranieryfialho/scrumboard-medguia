// T-209 a T-212 (fase4-admin): o que as rotas de administração têm em comum — papéis
// permitidos (ASM-202) e a base da URL do convite. A leitura da sessão e o 401/403 de
// "gerente ou acima" vêm de `exigirGerente` (src/lib/relatorios/acesso.ts); o de "só super
// admin" é `exigirSuperAdmin`, aqui.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../db/client';
import { getAuth } from '../auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../auth/tenant';

export { exigirGerente } from '../relatorios/acesso';

/** MASTER e super admin trocam papel, desativam e convidam qualquer papel (ASM-202). */
export function ehMasterOuSuper(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER';
}

export async function exigirSuperAdmin(request: NextRequest): Promise<{ contexto: ContextoTenant } | { resposta: NextResponse }> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  const nao = { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };
  if (!sessao) return nao;
  let contexto: ContextoTenant;
  try {
    contexto = await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return nao;
    throw erro;
  }
  if (!contexto.isSuperAdmin) return { resposta: NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 }) };
  return { contexto };
}

export function baseDaUrl(request: NextRequest): string {
  return (process.env['APP_URL'] || process.env.NEXT_PUBLIC_APP_URL) || `https://${request.headers.get('host')}`;
}

// Quem acessa as campanhas de e-mail: super admin, master e quem tem o módulo "Campanhas" liberado. Gerente tem por padrão; atendente só
// se o master ou o gerente liberar (ASM-076, revista): o mesmo critério do menu e das páginas, agora também na API.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../db/client';
import { getAuth } from '../auth/instancia';
import { modulosEfetivos } from '../auth/modulos';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../auth/tenant';

export function acessoACampanhas(contexto: Pick<ContextoTenant, 'isSuperAdmin' | 'papel' | 'modulos'>): boolean {
  return contexto.isSuperAdmin || modulosEfetivos(contexto.papel, false, contexto.modulos).has('campanhas');
}

/** Sessão (401) e acesso às campanhas (403); devolve o contexto do tenant. Mesmo formato de `exigirGerente`. */
export async function exigirAcessoACampanhas(request: NextRequest): Promise<{ contexto: ContextoTenant } | { resposta: NextResponse }> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };
  let contexto: ContextoTenant;
  try {
    contexto = await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return { resposta: NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 }) };
    throw erro;
  }
  if (!acessoACampanhas(contexto)) return { resposta: NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 }) };
  return { contexto };
}

// T-144 (fase4-design-system-shell-acesso, US-098): troca da empresa ativa
// pelo super admin a partir do seletor do topo (AC-353) — compõe
// `trocarEmpresaAtiva` (fase1-auth-rbac, T-032, AC-045/AC-046) com a
// resolução de sessão já usada pelas outras rotas (ver
// src/app/api/oportunidades/route.ts).
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { empresas } from '../../../db/schema';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { ErroTrocaEmpresaNaoAutorizada, trocarEmpresaAtiva } from '../../../lib/auth/troca-empresa';

export const dynamic = 'force-dynamic';

interface SessaoResolvida {
  contexto: ContextoTenant;
  token: string;
}

async function resolverSessao(request: NextRequest): Promise<SessaoResolvida | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    const contexto = await resolverContextoTenant(getDb(), { token: sessao.session.token });
    return { contexto, token: sessao.session.token };
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

function semPermissao() {
  return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
}

/** AC-353: só o super admin troca a empresa ativa da sessão; a próxima chamada de `/api/me` reflete a nova empresa. */
export async function POST(request: NextRequest) {
  const sessao = await resolverSessao(request);
  if (!sessao) return semSessao();

  const corpo = await request.json().catch(() => null);
  const empresaId = corpo?.empresaId;
  if (typeof empresaId !== 'string' || empresaId.length === 0) {
    return NextResponse.json({ codigo: 'EMPRESA_ID_OBRIGATORIO' }, { status: 400 });
  }

  const db = getDb();
  const empresasEncontradas = await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).where(eq(empresas.id, empresaId)).limit(1);
  const empresaNova = empresasEncontradas[0];
  if (!empresaNova) {
    return NextResponse.json({ codigo: 'EMPRESA_NAO_ENCONTRADA' }, { status: 404 });
  }

  const { contexto, token } = sessao;
  try {
    await trocarEmpresaAtiva(
      { usuarioId: contexto.usuarioId, empresaId: contexto.empresaId, isSuperAdmin: contexto.isSuperAdmin },
      token,
      empresaNova.id
    );
  } catch (erro) {
    if (erro instanceof ErroTrocaEmpresaNaoAutorizada) return semPermissao();
    throw erro;
  }

  return NextResponse.json({ empresaAtiva: empresaNova });
}

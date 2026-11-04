// T-144 (fase4-design-system-shell-acesso, US-104/US-098): entrega os dados
// que o topo e o menu da casca (T-146) precisam renderizar (AC-352/AC-383),
// sem reimplementar a resolução de sessão — mesmo par
// `getAuth().api.getSession` + `resolverContextoTenant` já usado por outras
// rotas (ver src/app/api/oportunidades/route.ts).
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { empresas, usuarios } from '../../../db/schema';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';

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

/**
 * AC-383: nome, e-mail, papel, `isSuperAdmin` e empresa ativa (id e nome)
 * para qualquer sessão válida; só para super admin, também a lista das
 * empresas (AC-353 — é o que a casca usa para decidir se mostra o seletor).
 */
export async function GET(request: NextRequest) {
  const sessao = await resolverSessao(request);
  if (!sessao) return semSessao();

  const { contexto } = sessao;
  const db = getDb();
  // AC-728: o contexto já resolve a empresa escolhida pelo super admin (gravada na sessão).
  const empresaAtivaId = contexto.empresaId;

  const [usuariosEncontrados, empresasAtivaEncontrada] = await Promise.all([
    db.select({ nome: usuarios.nome, email: usuarios.email }).from(usuarios).where(eq(usuarios.id, contexto.usuarioId)).limit(1),
    db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).where(eq(empresas.id, empresaAtivaId)).limit(1),
  ]);

  const usuario = usuariosEncontrados[0];
  const empresaAtiva = empresasAtivaEncontrada[0];
  if (!usuario || !empresaAtiva) return semSessao();

  const corpo: Record<string, unknown> = {
    nome: usuario.nome,
    email: usuario.email,
    papel: contexto.papel,
    isSuperAdmin: contexto.isSuperAdmin,
    empresaAtiva,
    // T-322: os módulos liberados da pessoa (ausente = padrão do papel); a casca esconde do menu o que não for dela.
    ...(contexto.modulos ? { modulos: contexto.modulos } : {}),
  };

  if (contexto.isSuperAdmin) {
    corpo.empresas = await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).orderBy(empresas.nome);
  }

  return NextResponse.json(corpo);
}

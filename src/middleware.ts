// T-143 (fase4-design-system-shell-acesso, US-104): middleware do Better
// Auth — substitui o middleware do Supabase (fase1-auth-rbac deixou o
// Supabase só no legado). Roda em runtime Node.js (`export const runtime`
// abaixo) porque resolve a sessão com o mesmo par já usado pelas rotas de
// API (`getAuth().api.getSession` + `resolverContextoTenant`, ver
// src/app/api/oportunidades/route.ts) — uma consulta ao Postgres da própria
// aplicação, nunca ao Supabase (AC-384).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from './db/client';
import { getAuth } from './lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from './lib/auth/tenant';
import { ehRotaPublica, podeAcessarRota } from './lib/auth/rotas';

export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

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

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

function semPermissao() {
  return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // AC-380: rotas públicas passam direto, autenticadas ou não.
  if (ehRotaPublica(pathname)) {
    return NextResponse.next();
  }

  const ehApi = pathname.startsWith('/api/');
  const contexto = await resolverContexto(request);

  // AC-379: sem sessão, página vai para o login (preservando o destino em
  // `next`) e API responde 401 sem redirecionar.
  if (!contexto) {
    if (ehApi) {
      return semSessao();
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // AC-381: papel sem permissão vai para `/sem-acesso` e API responde 403.
  if (!podeAcessarRota(contexto, pathname)) {
    if (ehApi) {
      return semPermissao();
    }
    const url = request.nextUrl.clone();
    url.pathname = '/sem-acesso';
    url.search = '';
    url.searchParams.set('de', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

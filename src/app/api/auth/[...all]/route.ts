// T-144 (fase4-design-system-shell-acesso, US-104): rota HTTP catch-all que
// entrega ao navegador o handler do Better Auth já configurado em
// src/lib/auth/instancia.ts (schema em português, `BETTER_AUTH_SECRET`,
// cookie `HttpOnly`/`Secure`/`SameSite=Lax`) — sign-in, sign-out,
// get-session etc. (AC-378). `getAuth()` só é chamado dentro do handler
// (nunca no escopo do módulo) pelo mesmo motivo do singleton em
// instancia.ts: `next build` coleta dados de página importando este arquivo
// antes de `DATABASE_URL` existir.
import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '../../../../lib/auth/instancia';

export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}

// T-301 (fase4-tarefas-agenda, AC-766): `GET /api/reunioes/meet` — se a empresa tem o Google conectado e qual conta; qualquer papel logado
// pode ver (a agenda mostra o estado do Meet para todos). Nunca devolve token.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao } from '../../../../lib/auth/sessao';
import { lerGoogleConectado } from '../../../../repositories/google-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  return NextResponse.json(await lerGoogleConectado(getDb(), contexto.empresaId));
}

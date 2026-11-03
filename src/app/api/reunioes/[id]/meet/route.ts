// T-301 (fase4-tarefas-agenda, US-122, AC-767): `POST /api/reunioes/:id/meet` — gera a sala do Google Meet de uma reunião que ainda não tem.
// Mesmo padrão das outras ações da agenda: 401 sem sessão; reunião de outra empresa ou de um card em que o usuário não pode agir é 404.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { gerarMeetDaReuniao } from '../../../../../repositories/reunioes-acoes';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_HTTP: Record<string, number> = {
  REUNIAO_NAO_ENCONTRADA: 404,
  REUNIAO_NAO_PODE_GERAR_MEET: 422,
  GOOGLE_NAO_CONECTADO: 409,
  FALHA_NO_GOOGLE: 502,
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'REUNIAO_NAO_ENCONTRADA' }, { status: 404 });

  const r = await gerarMeetDaReuniao(getDb(), contexto, id);
  if (r.ok) return NextResponse.json({ meetUrl: r.meetUrl });
  return NextResponse.json({ codigo: r.codigo }, { status: STATUS_HTTP[r.codigo] ?? 422 });
}

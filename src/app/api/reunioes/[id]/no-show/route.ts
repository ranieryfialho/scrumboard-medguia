// T-185 (fase4-tarefas-agenda, US-122): `POST /api/reunioes/[id]/no-show` — registra a falta e leva o card para "No-show" (AC-491).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { registrarNoShow } from '../../../../../repositories/reunioes-acoes';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const STATUS_HTTP: Record<string, number> = {
  REUNIAO_NAO_ENCONTRADA: 404,
  OPORTUNIDADE_NAO_ENCONTRADA: 404,
  DATA_NO_PASSADO: 400,
  REQUISICAO_INVALIDA: 400,
  CONFLITO_DE_VERSAO: 409,
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'REUNIAO_NAO_ENCONTRADA' }, { status: 404 });
  const r = await registrarNoShow(getDb(), contexto, id, new Date());

  if (r.ok) return NextResponse.json(r.reuniao);
  return NextResponse.json({ codigo: r.codigo }, { status: STATUS_HTTP[r.codigo] ?? 422 });
}

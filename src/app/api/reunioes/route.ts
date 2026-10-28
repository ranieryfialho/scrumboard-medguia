// T-184 (fase4-tarefas-agenda, US-121) e T-185 (US-122): `GET /api/reunioes`
// lista as reuniões de um período (AC-481); `POST /api/reunioes` agenda uma
// reunião e move o card para "Reunião agendada" (AC-489/AC-490).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { STATUS_DE_REUNIAO, type StatusReuniao } from '../../../lib/reunioes/status';
import { agendarReuniao } from '../../../repositories/reunioes-acoes';
import { diaValido, inicioDoDiaSP, listarReunioes } from '../../../repositories/reunioes';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIAS_MAXIMOS = 70;

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

/** ASM-163: ATENDENTE só vê/age nos próprios cards. */
function podeVerTodoTenant(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const p = request.nextUrl.searchParams;
  const de = p.get('de');
  const ate = p.get('ate');
  if (!diaValido(de) || !diaValido(ate)) return NextResponse.json({ codigo: 'PERIODO_INVALIDO' }, { status: 400 });
  const dias = (inicioDoDiaSP(ate).getTime() - inicioDoDiaSP(de).getTime()) / 86_400_000 + 1;
  if (dias < 1 || dias > DIAS_MAXIMOS) return NextResponse.json({ codigo: 'PERIODO_INVALIDO' }, { status: 400 });

  const closerId = p.get('closerId');
  if (closerId && !UUID.test(closerId)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  const status = p.get('status');
  if (status && !STATUS_DE_REUNIAO.includes(status as StatusReuniao)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const reunioes = await listarReunioes(getDb(), contexto, {
    de,
    ate,
    closerId: closerId ?? undefined,
    status: (status as StatusReuniao | null) ?? undefined,
    somenteResponsavelId: podeVerTodoTenant(contexto) ? undefined : contexto.usuarioId,
    agora: new Date(),
  });
  return NextResponse.json({ reunioes });
}

const STATUS_HTTP: Record<string, number> = {
  OPORTUNIDADE_NAO_ENCONTRADA: 404,
  DATA_NO_PASSADO: 400,
  REQUISICAO_INVALIDA: 400,
  CONFLITO_DE_VERSAO: 409,
};

export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const corpo = (await request.json().catch(() => null)) as { oportunidadeId?: unknown; agendadaPara?: unknown } | null;
  const data = typeof corpo?.agendadaPara === 'string' ? new Date(corpo.agendadaPara) : null;
  if (!corpo || typeof corpo.oportunidadeId !== 'string' || !UUID.test(corpo.oportunidadeId) || !data || Number.isNaN(data.getTime())) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const r = await agendarReuniao(getDb(), contexto, { oportunidadeId: corpo.oportunidadeId, agendadaPara: data, agora: new Date() });
  if (r.ok) return NextResponse.json(r.reuniao, { status: 201 });
  return NextResponse.json({ codigo: r.codigo }, { status: STATUS_HTTP[r.codigo] ?? 422 });
}

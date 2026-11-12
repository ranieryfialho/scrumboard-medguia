// fase6-atendimento-lead (US-182, AC-790/AC-791): o horário de atendimento da empresa da sessão. `GET` é de qualquer sessão (o
// relatório de marketing mostra o expediente que usa); `PUT` é de gerente em diante e recusa horário inválido com 400
// `HORARIO_INVALIDO`, deixando o que valia como estava.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { validarHorario } from '../../../../domain/atendimento/horario-comercial';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { gravarHorarioAtendimento, lerHorarioAtendimento } from '../../../../repositories/horario-atendimento';

export const dynamic = 'force-dynamic';

async function sessao(request: NextRequest): Promise<ContextoTenant | null> {
  const s = await getAuth().api.getSession({ headers: request.headers });
  if (!s) return null;
  try {
    return await resolverContextoTenant(getDb(), { token: s.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

export async function GET(request: NextRequest) {
  const contexto = await sessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  return NextResponse.json(await lerHorarioAtendimento(getDb(), contexto));
}

export async function PUT(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as { horario?: unknown } | null;
  const validado = validarHorario(corpo?.horario);
  if (!validado.ok) return NextResponse.json({ codigo: 'HORARIO_INVALIDO', mensagem: validado.mensagem }, { status: 400 });

  await gravarHorarioAtendimento(getDb(), acesso.contexto, validado.horario);
  return NextResponse.json(await lerHorarioAtendimento(getDb(), acesso.contexto));
}

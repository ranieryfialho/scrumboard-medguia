// T-050 (fase2-kanban, US-032): lista os motivos de perda ativos — o modal
// de dado faltante (AC-088) precisa dos ids reais (`motivos_perda.id` é
// `uuid defaultRandom()`, não dá pra hardcodar no cliente) pra montar o
// select de `MOTIVO_PERDA_OBRIGATORIO`. fase5-motivos-por-empresa (AC-664): vêm os globais
// ativos e os ativos da empresa da sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { listarMotivosAtivos } from '../../../repositories/motivos-perda';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) {
    return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  }

  let contexto: ContextoTenant;
  try {
    contexto = await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) {
      return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
    }
    throw erro;
  }

  const motivos = await listarMotivosAtivos(getDb(), contexto.empresaId);

  return NextResponse.json({ itens: motivos });
}

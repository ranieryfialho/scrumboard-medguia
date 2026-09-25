// T-050 (fase2-kanban, US-032): lista os motivos de perda ativos — o modal
// de dado faltante (AC-088) precisa dos ids reais (`motivos_perda.id` é
// `uuid defaultRandom()`, não dá pra hardcodar no cliente) pra montar o
// select de `MOTIVO_PERDA_OBRIGATORIO`. Tabela global, sem `empresa_id` —
// não passa por `comTenant`, só exige sessão válida.
import { asc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { motivosPerda } from '../../../db/schema';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant } from '../../../lib/auth/tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) {
    return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  }

  try {
    await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) {
      return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
    }
    throw erro;
  }

  const motivos = await getDb()
    .select({ id: motivosPerda.id, nome: motivosPerda.nome })
    .from(motivosPerda)
    .where(eq(motivosPerda.ativo, true))
    .orderBy(asc(motivosPerda.nome));

  return NextResponse.json({ itens: motivos });
}

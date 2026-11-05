// T-202 (fase4-analises, AC-563): `GET /api/relatorios/marketing` — resumo, série e
// desempenho por origem dos leads criados no período. 401/403/400 antes do banco.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirModulo } from '../../../../lib/auth/exigir-modulo';
import { lerParametros } from '../../../../lib/relatorios/acesso';
import { obterMarketing } from '../../../../repositories/analises-marketing';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirModulo(request, 'relatorios');
  if ('resposta' in acesso) return acesso.resposta;
  const leitura = lerParametros(request.nextUrl.searchParams);
  if (!leitura.ok) return leitura.resposta;

  const { de, ate, origem, especialidade, agrupar } = leitura.parametros;
  return NextResponse.json(await obterMarketing(getDb(), acesso.contexto, { de, ate, origem, especialidade, agrupar, agora: new Date() }));
}

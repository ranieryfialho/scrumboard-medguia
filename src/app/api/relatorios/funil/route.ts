// T-201 (fase4-analises, AC-557): `GET /api/relatorios/funil` — funil por etapa e
// desempenho por responsável, na coorte dos 7 indicadores. 401/403/400 antes do banco.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirModulo } from '../../../../lib/auth/exigir-modulo';
import { lerParametros } from '../../../../lib/relatorios/acesso';
import { obterFunil } from '../../../../repositories/analises-funil';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirModulo(request, 'indicadores');
  if ('resposta' in acesso) return acesso.resposta;
  const leitura = lerParametros(request.nextUrl.searchParams);
  if (!leitura.ok) return leitura.resposta;

  const { de, ate, responsavelId } = leitura.parametros;
  return NextResponse.json(await obterFunil(getDb(), acesso.contexto, { de, ate, responsavelId, agora: new Date() }));
}

// T-203 (fase4-analises, AC-569): `GET /api/relatorios/comercial` — resumo, evolução
// semanal, ranking e motivos de perda. 401/403/400 antes do banco.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirGerente, lerParametros } from '../../../../lib/relatorios/acesso';
import { obterComercial } from '../../../../repositories/analises-comercial';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const leitura = lerParametros(request.nextUrl.searchParams);
  if (!leitura.ok) return leitura.resposta;

  const { de, ate, responsavelId, especialidade } = leitura.parametros;
  return NextResponse.json(await obterComercial(getDb(), acesso.contexto, { de, ate, responsavelId, especialidade, agora: new Date() }));
}

// T-310 (fase4-analises, US-133): `GET /api/relatorios/alertas?responsavelId=` — propostas paradas há mais de 48 h e no-shows sem
// resgate. Gerente, master e super admin (mesma regra dos demais relatórios).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirModulo } from '../../../../lib/auth/exigir-modulo';
import { obterAlertasComerciais } from '../../../../repositories/alertas-comerciais';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const acesso = await exigirModulo(request, 'indicadores');
  if ('resposta' in acesso) return acesso.resposta;
  const responsavelId = request.nextUrl.searchParams.get('responsavelId') ?? undefined;
  if (responsavelId && !UUID.test(responsavelId)) return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem: 'responsavelId inválido.' }, { status: 400 });
  return NextResponse.json(await obterAlertasComerciais(getDb(), acesso.contexto, responsavelId));
}

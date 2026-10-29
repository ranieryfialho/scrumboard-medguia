// T-247 (fase5-whatsapp-lote-base, AC-674): `GET /api/whatsapp/lote/regras` — o limite por disparo e o intervalo
// entre mensagens do WhatsApp em lote (valores do sistema, ASM-243). Qualquer sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { INTERVALO_MAXIMO_SEGUNDOS, INTERVALO_MINIMO_SEGUNDOS, LIMITE_POR_DISPARO } from '../../../../../lib/whatsapp/lote-regras';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!(await contextoDaSessao(request))) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  return NextResponse.json({ limitePorDisparo: LIMITE_POR_DISPARO, intervalo: { minimoSegundos: INTERVALO_MINIMO_SEGUNDOS, maximoSegundos: INTERVALO_MAXIMO_SEGUNDOS } });
}

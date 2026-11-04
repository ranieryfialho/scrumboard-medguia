// T-304 (fase4-whatsapp, US-126): `POST /api/whatsapp/desconectar` — encerra a sessão do WhatsApp da empresa na Evolution.
// 401 sem sessão, 403 fora de MASTER/GERENTE/super admin, 409 sem instância, 502 se a Evolution recusar.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../lib/auth/sessao';
import { buildConfig, logoutInstance } from '../../../../lib/evolution-api';
import { buscarNomeInstancia } from '../../../../repositories/whatsapp-instancia';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  const nomeInstancia = await buscarNomeInstancia(getDb(), contexto);
  if (!nomeInstancia) return NextResponse.json({ codigo: 'WHATSAPP_NAO_CONFIGURADO' }, { status: 409 });
  const ok = await logoutInstance(buildConfig(nomeInstancia));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ codigo: 'FALHA_EVOLUTION' }, { status: 502 });
}

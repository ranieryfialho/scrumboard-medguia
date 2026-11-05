// `GET ?leadId=` devolve os valores dos shortcodes do lead (lead, card, reunião, empresa), para a conversa preencher os templates.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao } from '../../../../lib/auth/sessao';
import { contextosDosLeads } from '../../../../repositories/whatsapp-template-contexto';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const leadId = request.nextUrl.searchParams.get('leadId');
  if (!leadId || !UUID.test(leadId)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  const mapa = await contextosDosLeads(getDb(), contexto, [leadId]);
  return NextResponse.json({ contexto: mapa.get(leadId) ?? {} });
}

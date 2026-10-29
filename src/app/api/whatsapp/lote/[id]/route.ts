// T-252 (fase5-whatsapp-lote-disparo, AC-683): `GET /api/whatsapp/lote/[id]` — o lote e a situação de cada destinatário.
// Lote de outra empresa ou id inválido é 404; só gerente+.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../../lib/auth/sessao';
import { detalharLote } from '../../../../../repositories/whatsapp-lote';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'LOTE_NAO_ENCONTRADO' }, { status: 404 });
  const detalhe = await detalharLote(getDb(), contexto, id);
  return detalhe ? NextResponse.json(detalhe) : NextResponse.json({ codigo: 'LOTE_NAO_ENCONTRADO' }, { status: 404 });
}

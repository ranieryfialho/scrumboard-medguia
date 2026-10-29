// T-252 (fase5-whatsapp-lote-disparo, AC-684): `POST /api/whatsapp/lote/[id]/cancelar` — cancela o que ainda não saiu.
// 422 `LOTE_ENCERRADO` se o lote já concluiu ou foi cancelado; só gerente+.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../../../lib/auth/sessao';
import { cancelarLote } from '../../../../../../repositories/whatsapp-lote';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'LOTE_NAO_ENCONTRADO' }, { status: 404 });
  const r = await cancelarLote(getDb(), contexto, id);
  if (r.ok) return NextResponse.json(r.lote);
  return NextResponse.json({ codigo: r.codigo }, { status: r.codigo === 'LOTE_NAO_ENCONTRADO' ? 404 : 422 });
}

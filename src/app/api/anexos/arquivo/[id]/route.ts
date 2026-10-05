// T-056 (fase2c-anexos, US-035): GET /api/anexos/arquivo/:id?emp&exp&sig —
// entrega os bytes. Não exige sessão: a assinatura HMAC (emitida por
// /api/anexos/:id só depois da checagem de tenant) é a credencial, e vale 60 s
// (AC-103/AC-104). Qualquer falha de assinatura é 403 sem tocar no volume.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { lerAnexo } from '../../../../../lib/anexos/armazenamento';
import { verificarAssinatura } from '../../../../../lib/anexos/assinatura';
import { buscarAnexoPorId } from '../../../../../repositories/anexos';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function linkInvalido() {
  return NextResponse.json({ codigo: 'LINK_INVALIDO' }, { status: 403 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const busca = request.nextUrl.searchParams;
  const empresaId = busca.get('emp');

  if (!UUID.test(id) || !empresaId || !UUID.test(empresaId)) return linkInvalido();
  if (!verificarAssinatura(id, empresaId, busca.get('exp'), busca.get('sig'))) return linkInvalido();

  const anexo = await buscarAnexoPorId(getDb(), { empresaId }, id);
  if (!anexo) return NextResponse.json({ codigo: 'ANEXO_NAO_ENCONTRADO' }, { status: 404 });

  const bytes = await lerAnexo(anexo.caminho);
  return new NextResponse(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': anexo.mime,
      'Content-Length': String(bytes.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

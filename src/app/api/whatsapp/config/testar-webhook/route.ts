// T-305 (fase4-whatsapp, US-127): `POST /api/whatsapp/config/testar-webhook` — manda um "ping" (evento sem mensagem) ao próprio
// webhook do CRM, com o segredo guardado no servidor, e devolve o código HTTP e o tempo. Prova que a URL pública chega ao CRM
// e que o segredo confere, sem criar nenhuma mensagem. 401 sem sessão, 403 fora de MASTER/GERENTE/super admin.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../../lib/auth/sessao';
import { origemDaRequisicao } from '../../../../../lib/google/origem';
import { obterOuCriarSegredoWebhook } from '../../../../../repositories/whatsapp-config';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });

  const segredo = await obterOuCriarSegredoWebhook(getDb(), contexto);
  const origem = origemDaRequisicao(request.headers, request.nextUrl);
  const url = `${origem}/api/whatsapp/webhook?empresa_id=${encodeURIComponent(contexto.empresaId)}&secret=${encodeURIComponent(segredo)}`;
  const inicio = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'ping.crm', data: {} }), signal: AbortSignal.timeout(8000) });
    return NextResponse.json({ ok: r.ok, status: r.status, ms: Date.now() - inicio });
  } catch {
    return NextResponse.json({ ok: false, status: 0, ms: Date.now() - inicio });
  }
}

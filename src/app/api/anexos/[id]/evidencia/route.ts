// T-294 (fase4-card-abas, US-112, AC-752/AC-753): `POST` torna o anexo evidência da etapa atual do card e `DELETE` desfaz.
// Qualquer papel que acessa o card faz as duas coisas; ambas deixam um evento na linha do tempo. Anexo de outra empresa ou
// inexistente é 404 (fail-closed).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { removerEvidencia, tornarEvidencia } from '../../../../../repositories/anexos-gestao';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function aplicar(request: NextRequest, params: Promise<{ id: string }>, acao: typeof tornarEvidencia) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'ANEXO_NAO_ENCONTRADO' }, { status: 404 });

  const resultado = await acao(getDb(), contexto, id);
  if (!resultado.ok) return NextResponse.json({ codigo: resultado.codigo }, { status: 404 });
  return NextResponse.json({ alterado: resultado.alterado });
}

export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return aplicar(request, params, tornarEvidencia);
}

export function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return aplicar(request, params, removerEvidencia);
}

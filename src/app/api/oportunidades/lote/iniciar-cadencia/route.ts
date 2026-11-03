// T-296 (fase4-pipeline-lote, US-115, AC-759/AC-760): POST /api/oportunidades/lote/iniciar-cadencia — inicia a cadência de vários cards de
// "Entrada de leads" de uma vez (barra da lista e botão "Iniciar Cadência em Massa" do funil). Mesmo padrão dos outros lotes: sessão
// (401) antes de tocar no banco, pedido inválido (lista vazia ou com mais de 100 ids) é 400, e a resposta diz, por card, se foi iniciado
// ou o código do motivo.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { idsDeLoteValidos, iniciarCadenciaEmLote } from '../../../../../repositories/lote-oportunidades';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const corpo = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  if (!corpo || !idsDeLoteValidos(corpo.ids)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });

  return NextResponse.json(await iniciarCadenciaEmLote(getDb(), contexto, corpo.ids, new Date()));
}

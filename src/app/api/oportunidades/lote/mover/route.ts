// T-176 (fase4-pipeline-lote, US-115): POST /api/oportunidades/lote/mover —
// move vários cards para uma etapa de uma vez (barra de ações da lista, tela 7).
// Mesmo padrão de sessão das demais rotas de `/api/oportunidades` (401 antes de
// tocar no banco). Pedido inválido (lista vazia, com mais de 100 ids ou etapa
// que não é número) é 400, também antes de tocar no banco. Cada card é
// processado sozinho pela mesma regra do card avulso, e a resposta diz, por
// card, se foi movido ou o código do motivo.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { idsDeLoteValidos, moverEmLote } from '../../../../../repositories/lote-oportunidades';

export const dynamic = 'force-dynamic';

async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

/** AC-446 a AC-448: move os cards pelas mesmas regras de um card, e diz o resultado de cada um. */
export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const corpo = (await request.json().catch(() => null)) as { ids?: unknown; etapaDestinoId?: unknown } | null;
  if (!corpo || !idsDeLoteValidos(corpo.ids) || typeof corpo.etapaDestinoId !== 'number') {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const lote = await moverEmLote(getDb(), contexto, corpo.ids, { etapaDestinoId: corpo.etapaDestinoId });
  return NextResponse.json(lote);
}

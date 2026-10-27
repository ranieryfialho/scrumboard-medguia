// T-177 (fase4-pipeline-lote, US-117): POST /api/oportunidades/lote/arquivar —
// leva vários cards para "Perdido" com o motivo escolhido (ASM-154), pelas
// MESMAS regras da transição de um card (`moverEmLote`, T-176): quem não puder
// aparece na lista de falhas. Sem motivo é 400 `MOTIVO_OBRIGATORIO` e motivo que
// não existe ou está inativo é 400 `MOTIVO_INVALIDO`, ambos antes de tocar em
// qualquer card.
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { motivosPerda } from '../../../../../db/schema';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { idsDeLoteValidos, moverEmLote } from '../../../../../repositories/lote-oportunidades';

export const dynamic = 'force-dynamic';

const ETAPA_PERDIDO = 14;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** AC-453/AC-454. */
export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const corpo = (await request.json().catch(() => null)) as { ids?: unknown; motivoPerdaId?: unknown } | null;
  if (!corpo || !idsDeLoteValidos(corpo.ids)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }
  if (typeof corpo.motivoPerdaId !== 'string' || corpo.motivoPerdaId.trim() === '') {
    return NextResponse.json({ codigo: 'MOTIVO_OBRIGATORIO' }, { status: 400 });
  }

  // Motivo de perda é tabela global; um id que não existe (ou inativo) nunca chega à transição.
  const db = getDb();
  const [motivo] = UUID.test(corpo.motivoPerdaId)
    ? await db.select({ ativo: motivosPerda.ativo }).from(motivosPerda).where(eq(motivosPerda.id, corpo.motivoPerdaId)).limit(1)
    : [];
  if (!motivo || !motivo.ativo) {
    return NextResponse.json({ codigo: 'MOTIVO_INVALIDO' }, { status: 400 });
  }

  const lote = await moverEmLote(db, contexto, corpo.ids, {
    etapaDestinoId: ETAPA_PERDIDO,
    motivoPerdaId: corpo.motivoPerdaId,
  });
  return NextResponse.json(lote);
}

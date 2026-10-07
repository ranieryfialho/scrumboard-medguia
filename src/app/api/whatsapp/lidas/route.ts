// T-080 (fase2c-whatsapp-conversa, US-046): rota POST /api/whatsapp/lidas —
// marca como lidas as recebidas de uma conversa (`{ leadId }` ou `{ numero
// }`), zerando o contador de `/api/whatsapp/unread` para a empresa toda
// (AC-156, AC-157, AC-158, AC-159), via `marcarConversaComoLida` (T-076).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { normalizarNumero } from '../../../../domain/whatsapp/numero';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { marcarConversaComoLida, type AlvoConversa } from '../../../../repositories/whatsapp';

export const dynamic = 'force-dynamic';

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

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

function requisicaoInvalida() {
  return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
}

/** Exatamente um entre `leadId` (UUID) e `numero` (normalizável) — nunca os dois, nunca nenhum. */
function validarCorpo(corpo: unknown): AlvoConversa | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const { leadId, numero } = corpo as Record<string, unknown>;

  const temLeadId = typeof leadId === 'string' && leadId.trim() !== '';
  const temNumero = typeof numero === 'string' && numero.trim() !== '';
  if (temLeadId === temNumero) return null;

  if (temLeadId) {
    if (!UUID.test(leadId as string)) return null;
    return { leadId: leadId as string };
  }

  const normalizado = normalizarNumero(numero as string);
  if (!normalizado) return null;
  return { numero: normalizado };
}

export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const corpoBruto = await request.json().catch(() => null);
  const alvo = validarCorpo(corpoBruto);
  if (!alvo) return requisicaoInvalida();

  const marcadas = await marcarConversaComoLida(getDb(), contexto, alvo);
  return NextResponse.json({ marcadas });
}

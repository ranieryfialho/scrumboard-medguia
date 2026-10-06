// T-080 (fase2c-whatsapp-conversa, US-046): rota GET /api/whatsapp/unread —
// substitui a legada em Supabase (lista vazia sem sessão, corte de 7 dias).
// Agora exige sessão (401) e lista as conversas com recebidas ainda não
// lidas, sem corte de tempo (AC-153, AC-154, AC-155, AC-156), via
// `listarConversasNaoLidas` (T-076).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { listarConversasNaoLidas } from '../../../../repositories/whatsapp';

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

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const conversas = await listarConversasNaoLidas(getDb(), contexto);
  return NextResponse.json({ conversas });
}

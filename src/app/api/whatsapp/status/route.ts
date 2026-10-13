// T-086 (fase2c-whatsapp-conexao, US-050): rota GET /api/whatsapp/status —
// substitui a legada em Supabase (service role, sem tenant). Ordem: sessão
// (401) → instância via `buscarNomeInstancia` (T-077, `comTenant`) → sem
// instância cadastrada responde `not_configured` sem chamar a Evolution
// (AC-175) → com instância, consulta a Evolution e traduz erro/indisponível
// em `state: "close"` (ASM-055, AC-177), nunca um erro HTTP. Resposta mantém
// os nomes do legado (`{ state, instance }`) — a tela não muda (fora de
// escopo da spec). Qualquer papel consulta (AC-176).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buildConfig, getInstanceStatus } from '../../../../lib/evolution-api';
import { buscarNomeInstancia } from '../../../../repositories/whatsapp-instancia';

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

  const db = getDb();
  const nomeInstancia = await buscarNomeInstancia(db, contexto);
  if (!nomeInstancia) {
    return NextResponse.json({ state: 'not_configured', instance: null });
  }

  const config = buildConfig(nomeInstancia);
  const status = await getInstanceStatus(config);
  const state = status?.instance?.state || status?.state || 'close';
  return NextResponse.json({ state, instance: nomeInstancia });
}

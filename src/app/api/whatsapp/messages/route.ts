// T-079 (fase2c-whatsapp-conversa, US-045): rota GET /api/whatsapp/messages —
// substitui a legada em Supabase. Ordem: sessão (401) → `numero` ou `leadId`
// válidos (400) → repositório de T-076 (`buscarHistoricoPorNumero` /
// `buscarHistoricoPorLead`). `leadId` de outra empresa devolve lista vazia,
// sem 404 (AC-151) — o próprio repositório já filtra por `empresa_id`.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { normalizarNumero } from '../../../../domain/whatsapp/numero';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buscarHistoricoPorLead, buscarHistoricoPorNumero } from '../../../../repositories/whatsapp';

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

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { searchParams } = new URL(request.url);
  const leadIdBruto = searchParams.get('leadId');
  const numeroBruto = searchParams.get('numero');

  const db = getDb();

  if (leadIdBruto) {
    if (!UUID.test(leadIdBruto)) return requisicaoInvalida();
    const mensagens = await buscarHistoricoPorLead(db, contexto, leadIdBruto);
    return NextResponse.json({ mensagens });
  }

  if (numeroBruto) {
    const numeroNormalizado = normalizarNumero(numeroBruto);
    if (!numeroNormalizado) return requisicaoInvalida();
    const mensagens = await buscarHistoricoPorNumero(db, contexto, numeroNormalizado);
    return NextResponse.json({ mensagens });
  }

  return requisicaoInvalida();
}

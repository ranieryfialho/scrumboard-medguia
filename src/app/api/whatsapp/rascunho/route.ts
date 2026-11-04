// T-303 (fase4-whatsapp, US-125): `GET/PUT/DELETE /api/whatsapp/rascunho` — o rascunho da mensagem avulsa da pessoa logada
// (um por usuário). 401 sem sessão; 400 corpo inválido.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao } from '../../../../lib/auth/sessao';
import { apagarRascunho, CATEGORIA_MAX, lerRascunho, NOME_MAX, salvarRascunho } from '../../../../repositories/whatsapp-avulsos';

export const dynamic = 'force-dynamic';

const MENSAGEM_MAX = 4096;
const naoAutenticado = () => NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

export async function GET(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return naoAutenticado();
  return NextResponse.json({ rascunho: await lerRascunho(getDb(), contexto) });
}

export async function PUT(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return naoAutenticado();
  const c = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const texto = (v: unknown, max: number) => (v === undefined ? '' : typeof v === 'string' && v.length <= max ? v : null);
  const numero = texto(c?.numero, 30);
  const nome = texto(c?.nome, NOME_MAX);
  const categoria = texto(c?.categoria, CATEGORIA_MAX);
  const mensagem = texto(c?.mensagem, MENSAGEM_MAX);
  if (!c || numero === null || nome === null || categoria === null || mensagem === null) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  await salvarRascunho(getDb(), contexto, { numero, nome, categoria, mensagem, criarLeadAoResponder: c.criarLeadAoResponder !== false });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return naoAutenticado();
  await apagarRascunho(getDb(), contexto);
  return NextResponse.json({ ok: true });
}

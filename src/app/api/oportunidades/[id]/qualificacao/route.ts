// fase6-qualificacao-comercial (US-198, AC-831): `GET` lê e `PUT` grava a qualificação comercial do card. Mesmo padrão de sessão/tenant das
// demais rotas de `/api/oportunidades`: 401 antes de tocar no banco; card de outra empresa ou inexistente é 404 (fail-closed). A nota e a
// faixa nunca vêm do corpo: o servidor calcula. Qualquer papel que acessa o card avalia (ASM-321).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { validarEntrada } from '../../../../../domain/qualificacao/qualificacao';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { buscarOportunidadePorId } from '../../../../../repositories/oportunidades';
import { gravarQualificacao, lerQualificacao } from '../../../../../repositories/qualificacao';

export const dynamic = 'force-dynamic';

const naoEncontrado = () => NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  if (!(await buscarOportunidadePorId(getDb(), contexto, id))) return naoEncontrado();
  return NextResponse.json(await lerQualificacao(getDb(), contexto, id));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  const validacao = validarEntrada(await request.json().catch(() => null));
  if (!validacao.ok) return NextResponse.json({ codigo: 'QUALIFICACAO_INVALIDA', campo: validacao.campo }, { status: 400 });
  if (!(await buscarOportunidadePorId(getDb(), contexto, id))) return naoEncontrado();
  return NextResponse.json(await gravarQualificacao(getDb(), contexto, id, validacao.entrada));
}

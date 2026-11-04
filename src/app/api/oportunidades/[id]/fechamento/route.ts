// T-313 (fase4-pipeline, US-114): `GET` lê e `PUT` grava o fechamento do cliente de um card (seis campos, todos obrigatórios).
// 401 sem sessão, 404 card de outra empresa ou inexistente, 400 corpo incompleto. Qualquer papel que acessa o card edita.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { lerFechamento } from '../../../../../domain/pipeline/fechamento';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { lerFechamentoDoCard, salvarFechamentoDoCard } from '../../../../../repositories/fechamento-card';
import { buscarOportunidadePorId } from '../../../../../repositories/oportunidades';

export const dynamic = 'force-dynamic';

const naoEncontrado = () => NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  if (!(await buscarOportunidadePorId(getDb(), contexto, id))) return naoEncontrado();
  return NextResponse.json({ fechamento: await lerFechamentoDoCard(getDb(), contexto, id) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  const dados = lerFechamento(await request.json().catch(() => null));
  if (!dados) return NextResponse.json({ codigo: 'FECHAMENTO_INVALIDO' }, { status: 400 });
  if (!(await buscarOportunidadePorId(getDb(), contexto, id))) return naoEncontrado();
  if (!(await salvarFechamentoDoCard(getDb(), contexto, id, dados))) return naoEncontrado();
  return NextResponse.json({ fechamento: await lerFechamentoDoCard(getDb(), contexto, id) });
}

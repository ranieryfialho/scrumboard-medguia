// T-289 (fase4-card-abas, US-114, AC-742/AC-743): `GET` lê e `PUT` edita (só os campos enviados) os dados comerciais do card —
// proposta e qualificação técnica da tela de conversa. Mesmo padrão de sessão/tenant das demais rotas de `/api/oportunidades`:
// 401 antes de tocar no banco; card de outra empresa ou inexistente é 404 (fail-closed). Qualquer papel que acessa o card edita.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { editarDadosComerciais, ErroCampoComercialInvalido, lerDadosComerciais } from '../../../../../repositories/dados-comerciais';
import { ErroCardNaoEncontrado } from '../../../../../repositories/edicao-card';
import { buscarOportunidadePorId } from '../../../../../repositories/oportunidades';

export const dynamic = 'force-dynamic';

const naoEncontrado = () => NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  if (!(await buscarOportunidadePorId(getDb(), contexto, id))) return naoEncontrado();
  return NextResponse.json(await lerDadosComerciais(getDb(), contexto, id));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return NextResponse.json({ codigo: 'CORPO_INVALIDO' }, { status: 400 });
  }
  if (!(await buscarOportunidadePorId(getDb(), contexto, id))) return naoEncontrado();

  try {
    const { alteracoes, dados } = await editarDadosComerciais(getDb(), contexto, id, corpo as Record<string, unknown>);
    return NextResponse.json({ ...dados, alteracoes });
  } catch (erro) {
    if (erro instanceof ErroCampoComercialInvalido) return NextResponse.json({ codigo: 'CAMPO_INVALIDO', campo: erro.campo }, { status: 400 });
    if (erro instanceof ErroCardNaoEncontrado) return naoEncontrado();
    throw erro;
  }
}

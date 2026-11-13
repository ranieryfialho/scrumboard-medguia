// Cadência: "o lead respondeu" no nível do card. O botão "Registrar Sucesso" do toque da vez precisa de um toque pendente, e entre um turno
// e o seguinte não existe nenhum; esta rota deixa o closer avisar a resposta a qualquer momento da régua. Efeito igual ao do `conectou`:
// cancela os toques que faltam, encerra a cadência e leva o card a Qualificando. Mesmo padrão de sessão, tenant, papel e versão das rotas
// de cadência (401 → 400 → 404 → 403 → 409/422).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../../db/client';
import { getAuth } from '../../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../../lib/auth/tenant';
import { ErroCadenciaEncerrada, ErroConflitoDeVersao, registrarRespostaDoLead } from '../../../../../../repositories/cadencia';
import { buscarOportunidadePorId } from '../../../../../../repositories/oportunidades';

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

function corpoValido(corpo: unknown): corpo is { version: number } {
  if (!corpo || typeof corpo !== 'object') return false;
  return typeof (corpo as Record<string, unknown>).version === 'number';
}

/** ASM-061: MASTER, GERENTE e super admin mexem em qualquer card do tenant; ATENDENTE só nos próprios. */
function podeMexerEmQualquerCard(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });

  const db = getDb();
  const oportunidade = await buscarOportunidadePorId(db, contexto, id);
  if (!oportunidade) return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });

  if (!podeMexerEmQualquerCard(contexto) && oportunidade.responsavelId !== contexto.usuarioId) {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  try {
    const atualizada = await registrarRespostaDoLead(db, contexto, id, { version: corpo.version, atorId: contexto.usuarioId, agora: new Date() });
    return NextResponse.json(atualizada);
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) return NextResponse.json({ codigo: 'CONFLITO_DE_VERSAO' }, { status: 409 });
    if (erro instanceof ErroCadenciaEncerrada) return NextResponse.json({ codigo: 'CADENCIA_ENCERRADA' }, { status: 422 });
    throw erro;
  }
}

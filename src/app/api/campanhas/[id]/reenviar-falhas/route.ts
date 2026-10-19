// T-105 (fase2d-campanhas, US-065): rota POST
// /api/campanhas/:id/reenviar-falhas (AC-241). A transição (só ERRO →
// PENDENTE, campanha volta a PROCESSANDO) já está em `reenviarFalhas`
// (src/repositories/campanhas.ts, T-104) — esta rota só traduz os erros
// tipados para o envelope HTTP.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import {
  ErroCampanhaNaoEncontrada,
  ErroSemFalhas,
  reenviarFalhas,
} from '../../../../../repositories/campanhas';

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

function semPermissao() {
  return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
}

function campanhaNaoEncontrada() {
  return NextResponse.json({ codigo: 'CAMPANHA_NAO_ENCONTRADA' }, { status: 404 });
}

/** ASM-076: MASTER, GERENTE e super admin acessam campanhas; ATENDENTE não. */
function podeAcessarCampanhas(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

/** AC-241: devolve os destinatários ERRO para a fila (PENDENTE) e volta a campanha a PROCESSANDO. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const { id } = await params;
  if (!UUID.test(id)) return campanhaNaoEncontrada();

  try {
    const resultado = await reenviarFalhas(getDb(), contexto, id);
    return NextResponse.json({
      id: resultado.campanha.id,
      status: resultado.campanha.status,
      totalReenviados: resultado.totalReenviados,
    });
  } catch (erro) {
    if (erro instanceof ErroCampanhaNaoEncontrada) return campanhaNaoEncontrada();
    if (erro instanceof ErroSemFalhas) {
      return NextResponse.json({ codigo: 'SEM_FALHAS' }, { status: 422 });
    }
    throw erro;
  }
}

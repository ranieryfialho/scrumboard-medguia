// T-267 (fase5-email-disparo, US-172, AC-710): rota POST /api/campanhas/:id/retomar. A transição atômica (campanha e
// destinatários na mesma transação) está em `retomarCampanha` (src/repositories/campanhas.ts) — esta rota só traduz os erros
// tipados para o envelope HTTP. ASM-265: gerente, master e super admin; atendente 403; outra empresa 404.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { ErroCampanhaNaoEncontrada, ErroCampanhaNaoPausada, retomarCampanha } from '../../../../../repositories/campanhas';
import { acessoACampanhas } from '../../../../../lib/campanhas/acesso';

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

/** ASM-076 (revista): super admin, master e quem tem o módulo Campanhas liberado (gerente por padrão; atendente só se liberarem). */
function podeAcessarCampanhas(contexto: ContextoTenant): boolean {
  return acessoACampanhas(contexto);
}

/** AC-710: retoma a campanha pausada e devolve os destinatários PAUSADO à fila; fora de pausa, 422 `CAMPANHA_NAO_PAUSADA`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const { id } = await params;
  if (!UUID.test(id)) return campanhaNaoEncontrada();

  try {
    const resultado = await retomarCampanha(getDb(), contexto, id);
    return NextResponse.json({ id: resultado.campanha.id, status: resultado.campanha.status, totalRetomados: resultado.totalRetomados });
  } catch (erro) {
    if (erro instanceof ErroCampanhaNaoEncontrada) return campanhaNaoEncontrada();
    if (erro instanceof ErroCampanhaNaoPausada) return NextResponse.json({ codigo: 'CAMPANHA_NAO_PAUSADA' }, { status: 422 });
    throw erro;
  }
}

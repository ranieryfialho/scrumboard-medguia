// T-177 (fase4-pipeline-lote, US-116): POST /api/oportunidades/lote/reatribuir —
// passa vários cards para outro responsável. Só MASTER, GERENTE e super admin
// (ASM-152): ATENDENTE é 403 antes de olhar o pedido. O responsável tem que ser
// usuário ativo da empresa da sessão (400 `RESPONSAVEL_INVALIDO`, sem tocar em
// nenhum card). Mesmo padrão de sessão das demais rotas de `/api/oportunidades`.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { idsDeLoteValidos } from '../../../../../repositories/lote-oportunidades';
import { ErroResponsavelInvalidoNoLote, reatribuirEmLote } from '../../../../../repositories/lote-reatribuicao';

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

/** AC-450 a AC-452. */
export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  if (!contexto.isSuperAdmin && contexto.papel !== 'MASTER' && contexto.papel !== 'GERENTE') {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  const corpo = (await request.json().catch(() => null)) as { ids?: unknown; responsavelId?: unknown } | null;
  if (!corpo || !idsDeLoteValidos(corpo.ids) || typeof corpo.responsavelId !== 'string' || corpo.responsavelId === '') {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  try {
    const lote = await reatribuirEmLote(getDb(), contexto, corpo.ids, corpo.responsavelId);
    return NextResponse.json(lote);
  } catch (erro) {
    if (erro instanceof ErroResponsavelInvalidoNoLote) {
      return NextResponse.json({ codigo: 'RESPONSAVEL_INVALIDO' }, { status: 400 });
    }
    throw erro;
  }
}

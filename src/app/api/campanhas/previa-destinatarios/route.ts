// T-196 (fase4-campanhas, AC-540): `GET /api/campanhas/previa-destinatarios?etapaIds=7,9,10` —
// quantos destinatários cada etapa dá e o total único, antes de criar a campanha.
// Só MASTER, GERENTE e super admin (ASM-076); `empresaId` só da sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { preverDestinatarios } from '../../../../repositories/campanhas-resumo';
import { acessoACampanhas } from '../../../../lib/campanhas/acesso';

export const dynamic = 'force-dynamic';

const TOTAL_DE_ETAPAS = 15;

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

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!acessoACampanhas(contexto)) {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  const bruto = request.nextUrl.searchParams.get('etapaIds') ?? '';
  const ids = bruto === '' ? [] : bruto.split(',').map((x) => Number(x));
  if (ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id >= 1 && id <= TOTAL_DE_ETAPAS)) {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem: 'etapaIds inválido.' }, { status: 400 });
  }

  return NextResponse.json(await preverDestinatarios(getDb(), contexto, [...new Set(ids)], request.nextUrl.searchParams.get('protegerFrequencia') === '1'));
}

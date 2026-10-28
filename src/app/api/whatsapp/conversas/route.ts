// T-189 (fase4-whatsapp, AC-500/AC-501/AC-506): `GET /api/whatsapp/conversas` —
// lista de conversas da caixa de entrada, com abas, busca e indicadores.
// 401 sem sessão; `empresaId` só da sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { listarConversas, type FiltroConversas } from '../../../../repositories/whatsapp-conversas';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTROS: readonly FiltroConversas[] = ['nao_lidas', 'minhas', 'todas', 'avulsas'];

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

  const p = request.nextUrl.searchParams;
  const filtro = (p.get('filtro') ?? 'todas') as FiltroConversas;
  if (!FILTROS.includes(filtro)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  const responsavelId = p.get('responsavelId');
  if (responsavelId && !UUID.test(responsavelId)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  const limite = p.get('limite') ? Number(p.get('limite')) : undefined;
  if (limite !== undefined && !Number.isInteger(limite)) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });

  const veTudo = contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
  const resposta = await listarConversas(getDb(), contexto, {
    filtro,
    busca: p.get('busca') ?? undefined,
    responsavelId: veTudo ? (responsavelId ?? undefined) : undefined,
    somenteDoUsuario: !veTudo,
    limite,
    agora: new Date(),
  });
  return NextResponse.json(resposta);
}

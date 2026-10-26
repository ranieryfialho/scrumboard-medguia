// T-155 (fase4-pipeline-telas, US-107): rota GET /api/oportunidades/lista —
// expõe `listarLista` (T-154) para a tela de lista (T-161). Mesmo padrão de
// sessão das demais rotas de `/api/oportunidades` (401 antes de tocar no
// banco; `empresaId` da URL é sempre ignorado — AC-397). Filtro, ordenação e
// paginação já são normalizados pelo repositório (AC-395/AC-396); esta rota
// só faz o parse dos query params.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import {
  listarLista,
  type DirecaoOrdenacao,
  type FiltroLista,
  type OrdenacaoLista,
} from '../../../../repositories/pipeline-lista';

export const dynamic = 'force-dynamic';

const ORDENACOES: readonly OrdenacaoLista[] = ['valor', 'proximaAcao', 'criadoEm'];
const DIRECOES: readonly DirecaoOrdenacao[] = ['asc', 'desc'];

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

/** AC-395/AC-396: parse dos query params — normalização de página/tamanho fica no repositório. */
function lerFiltro(searchParams: URLSearchParams): FiltroLista {
  const etapaIdParam = searchParams.get('etapaId');
  const paginaParam = searchParams.get('pagina');
  const porPaginaParam = searchParams.get('porPagina');
  const ordenarPorParam = searchParams.get('ordenarPor');
  const ordemParam = searchParams.get('ordem');

  return {
    etapaId: etapaIdParam !== null && etapaIdParam !== '' ? Number(etapaIdParam) : undefined,
    responsavelId: searchParams.get('responsavelId') ?? undefined,
    origem: searchParams.get('origem') ?? undefined,
    busca: searchParams.get('busca') ?? undefined,
    ordenarPor: ORDENACOES.includes(ordenarPorParam as OrdenacaoLista) ? (ordenarPorParam as OrdenacaoLista) : undefined,
    ordem: DIRECOES.includes(ordemParam as DirecaoOrdenacao) ? (ordemParam as DirecaoOrdenacao) : undefined,
    pagina: paginaParam !== null ? Number(paginaParam) : undefined,
    porPagina: porPaginaParam !== null ? Number(porPaginaParam) : undefined,
  };
}

/** AC-395/AC-396/AC-397/AC-398: lista paginada do pipeline ativo, filtrada e ordenada no servidor, só do tenant da sessão. */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const pagina = await listarLista(getDb(), contexto, lerFiltro(request.nextUrl.searchParams));

  return NextResponse.json({
    itens: pagina.itens.map((item) => ({
      ...item,
      proximaAcaoEm: item.proximaAcaoEm ? item.proximaAcaoEm.toISOString() : null,
      criadoEm: item.criadoEm.toISOString(),
    })),
    total: pagina.total,
    pagina: pagina.pagina,
    porPagina: pagina.porPagina,
  });
}

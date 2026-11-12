// T-155 (fase4-pipeline-telas, US-108): rota GET /api/oportunidades/arquivados
// — expõe `listarArquivados` (T-154) para a tela de arquivados (T-162). Mesmo
// padrão de sessão de `/api/oportunidades/lista`: 401 antes de tocar no
// banco; `empresaId`/`tipo` da URL nunca abrem a porta para outra empresa
// (AC-402). Normalização de página/tamanho fica no repositório.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { lerPeriodoDaConsulta } from '../../../../domain/pipeline/periodo';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { listarArquivados, type FiltroArquivados, type TipoArquivado } from '../../../../repositories/pipeline-lista';

export const dynamic = 'force-dynamic';

const TIPOS: readonly TipoArquivado[] = ['ganho', 'perdido'];

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

/** AC-402: parse dos query params — normalização de página/tamanho fica no repositório. */
function lerFiltro(searchParams: URLSearchParams): FiltroArquivados {
  const tipoParam = searchParams.get('tipo');
  const paginaParam = searchParams.get('pagina');
  const porPaginaParam = searchParams.get('porPagina');

  return {
    tipo: TIPOS.includes(tipoParam as TipoArquivado) ? (tipoParam as TipoArquivado) : undefined,
    motivoPerdaId: searchParams.get('motivoPerdaId') ?? undefined,
    responsavelId: searchParams.get('responsavelId') ?? undefined,
    busca: searchParams.get('busca') ?? undefined,
    de: searchParams.get('de') ?? undefined,
    ate: searchParams.get('ate') ?? undefined,
    pagina: paginaParam !== null ? Number(paginaParam) : undefined,
    porPagina: porPaginaParam !== null ? Number(porPaginaParam) : undefined,
  };
}

/** AC-402: lista paginada dos arquivados, filtrada no servidor, só do tenant da sessão. */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  // fase6-periodo-personalizado (AC-824): período inválido é recusado antes de consultar.
  const periodo = lerPeriodoDaConsulta(request.nextUrl.searchParams);
  if (!periodo.ok) return NextResponse.json({ codigo: 'PERIODO_INVALIDO' }, { status: 400 });

  const pagina = await listarArquivados(getDb(), contexto, { ...lerFiltro(request.nextUrl.searchParams), ...periodo.periodo });

  return NextResponse.json({
    itens: pagina.itens.map((item) => ({
      ...item,
      dataFechamento: item.dataFechamento.toISOString(),
    })),
    total: pagina.total,
    pagina: pagina.pagina,
    porPagina: pagina.porPagina,
  });
}

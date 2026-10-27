// T-179 (fase4-pipeline-lote, US-118): GET /api/oportunidades/lista/exportar —
// baixa em CSV TODOS os cards da lista que atendem aos filtros da tela (os mesmos
// parâmetros de `GET /api/oportunidades/lista`, sem a página). Só MASTER, GERENTE
// e super admin (403 para ATENDENTE; 401 sem sessão). Acima de 5.000 linhas é 422
// `LIMITE_EXCEDIDO`; sem nenhum card é 422 `NADA_PARA_EXPORTAR`. Cada arquivo
// entregue grava um registro (quem, quando, filtros, linhas) — e só ele.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { pipelineEtapas } from '../../../../../db/schema';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { formatarDataHoraCsv, formatarValorCsv, gerarCsv } from '../../../../../lib/csv/gerar-csv';
import { dataDeHojeParaArquivo, respostaCsv } from '../../../../../lib/csv/resposta-csv';
import {
  exportarLista,
  LIMITE_DE_LINHAS_DA_EXPORTACAO,
  registrarExportacao,
  type FiltroExportarLista,
} from '../../../../../repositories/exportar-carteira';
import type { DirecaoOrdenacao, OrdenacaoLista } from '../../../../../repositories/pipeline-lista';

export const dynamic = 'force-dynamic';

const ORDENACOES: readonly OrdenacaoLista[] = ['valor', 'proximaAcao', 'criadoEm'];
const DIRECOES: readonly DirecaoOrdenacao[] = ['asc', 'desc'];

const COLUNAS = ['Lead', 'Telefone', 'E-mail', 'Origem', 'Etapa', 'Responsável', 'Valor', 'Próxima ação', 'Criado em'] as const;

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

/** Os mesmos parâmetros da listagem, sem página nem tamanho de página. */
function lerFiltro(searchParams: URLSearchParams): FiltroExportarLista {
  const etapaIdParam = searchParams.get('etapaId');
  const ordenarPorParam = searchParams.get('ordenarPor');
  const ordemParam = searchParams.get('ordem');

  return {
    etapaId: etapaIdParam !== null && etapaIdParam !== '' ? Number(etapaIdParam) : undefined,
    responsavelId: searchParams.get('responsavelId') ?? undefined,
    origem: searchParams.get('origem') ?? undefined,
    busca: searchParams.get('busca') ?? undefined,
    ordenarPor: ORDENACOES.includes(ordenarPorParam as OrdenacaoLista) ? (ordenarPorParam as OrdenacaoLista) : undefined,
    ordem: DIRECOES.includes(ordemParam as DirecaoOrdenacao) ? (ordemParam as DirecaoOrdenacao) : undefined,
  };
}

/** AC-455/AC-457/AC-458/AC-459. */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  if (!contexto.isSuperAdmin && contexto.papel !== 'MASTER' && contexto.papel !== 'GERENTE') {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  const db = getDb();
  const filtro = lerFiltro(request.nextUrl.searchParams);
  const resultado = await exportarLista(db, contexto, filtro);

  if (resultado.excedeu) {
    return NextResponse.json(
      { codigo: 'LIMITE_EXCEDIDO', total: resultado.total, limite: LIMITE_DE_LINHAS_DA_EXPORTACAO },
      { status: 422 }
    );
  }
  if (resultado.itens.length === 0) {
    return NextResponse.json({ codigo: 'NADA_PARA_EXPORTAR' }, { status: 422 });
  }

  const etapas = new Map((await db.select({ id: pipelineEtapas.id, nome: pipelineEtapas.nome }).from(pipelineEtapas)).map((e) => [e.id, e.nome]));
  const csv = gerarCsv(
    COLUNAS,
    resultado.itens.map((item) => [
      item.lead.nome,
      item.lead.telefoneE164,
      item.lead.email,
      item.lead.origem,
      etapas.get(item.etapaId) ?? String(item.etapaId),
      item.responsavel?.nome ?? '',
      formatarValorCsv(item.valor),
      formatarDataHoraCsv(item.proximaAcaoEm),
      formatarDataHoraCsv(item.criadoEm),
    ])
  );

  // O registro entra antes de entregar: se não puder ser gravado, o arquivo não sai (AC-459).
  await registrarExportacao(db, contexto, {
    tela: 'lista',
    filtros: Object.fromEntries(Object.entries(filtro).filter(([, valor]) => valor !== undefined)),
    linhas: resultado.itens.length,
  });

  return respostaCsv(`pipeline-lista-${dataDeHojeParaArquivo()}.csv`, csv);
}

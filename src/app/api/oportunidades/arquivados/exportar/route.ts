// T-179 (fase4-pipeline-lote, US-118): GET /api/oportunidades/arquivados/exportar
// — baixa em CSV os arquivados que atendem à aba e aos filtros da tela (os mesmos
// parâmetros de `GET /api/oportunidades/arquivados`, sem a página). Mesmas regras
// da exportação da lista: só MASTER/GERENTE/super admin, teto de 5.000 linhas,
// registro de cada arquivo entregue.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { formatarDataHoraCsv, formatarValorCsv, gerarCsv } from '../../../../../lib/csv/gerar-csv';
import { dataDeHojeParaArquivo, respostaCsv } from '../../../../../lib/csv/resposta-csv';
import {
  exportarArquivados,
  LIMITE_DE_LINHAS_DA_EXPORTACAO,
  registrarExportacao,
  type FiltroExportarArquivados,
} from '../../../../../repositories/exportar-carteira';
import type { TipoArquivado } from '../../../../../repositories/pipeline-lista';

export const dynamic = 'force-dynamic';

const TIPOS: readonly TipoArquivado[] = ['ganho', 'perdido'];

const COLUNAS = ['Lead', 'Status', 'Consultor', 'Valor', 'Motivo da perda', 'Data de fechamento'] as const;

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

/** Os mesmos parâmetros da listagem de arquivados, sem página nem tamanho de página. */
function lerFiltro(searchParams: URLSearchParams): FiltroExportarArquivados {
  const tipoParam = searchParams.get('tipo');

  return {
    tipo: TIPOS.includes(tipoParam as TipoArquivado) ? (tipoParam as TipoArquivado) : undefined,
    motivoPerdaId: searchParams.get('motivoPerdaId') ?? undefined,
    responsavelId: searchParams.get('responsavelId') ?? undefined,
    busca: searchParams.get('busca') ?? undefined,
    de: searchParams.get('de') ?? undefined,
    ate: searchParams.get('ate') ?? undefined,
  };
}

/** AC-456/AC-457/AC-458/AC-459. */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  if (!contexto.isSuperAdmin && contexto.papel !== 'MASTER' && contexto.papel !== 'GERENTE') {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  const db = getDb();
  const filtro = lerFiltro(request.nextUrl.searchParams);
  const resultado = await exportarArquivados(db, contexto, filtro);

  if (resultado.excedeu) {
    return NextResponse.json(
      { codigo: 'LIMITE_EXCEDIDO', total: resultado.total, limite: LIMITE_DE_LINHAS_DA_EXPORTACAO },
      { status: 422 }
    );
  }
  if (resultado.itens.length === 0) {
    return NextResponse.json({ codigo: 'NADA_PARA_EXPORTAR' }, { status: 422 });
  }

  const csv = gerarCsv(
    COLUNAS,
    resultado.itens.map((item) => [
      item.lead.nome,
      item.status === 'ganho' ? 'Ganho' : 'Perdido',
      item.responsavel?.nome ?? '',
      formatarValorCsv(item.valor),
      item.motivoPerda?.nome ?? '',
      formatarDataHoraCsv(item.dataFechamento),
    ])
  );

  await registrarExportacao(db, contexto, {
    tela: 'arquivados',
    filtros: Object.fromEntries(Object.entries(filtro).filter(([, valor]) => valor !== undefined)),
    linhas: resultado.itens.length,
  });

  return respostaCsv(`pipeline-arquivados-${dataDeHojeParaArquivo()}.csv`, csv);
}

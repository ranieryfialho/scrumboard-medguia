// T-155 (fase4-pipeline-telas, US-106/US-108): rota GET
// /api/pipeline/indicadores?visao=funil|arquivados — expõe
// `obterIndicadoresFunil`/`obterIndicadoresArquivados` (T-154) para os
// cartões do topo do funil (AC-389) e dos arquivados (AC-403). Mesmo padrão
// de sessão das demais rotas da feature: 401 antes de tocar no banco;
// `visao` ausente ou fora de funil/arquivados é 400 (nunca cai num default
// silencioso). `agora` é o relógio real da requisição, como em
// `/api/relatorios/kpis` — a conta de cada indicador já é provada no
// repositório (T-154); aqui só se prova a composição da rota.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { obterIndicadoresArquivados, obterIndicadoresFunil } from '../../../../repositories/pipeline-indicadores';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';

export const dynamic = 'force-dynamic';

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

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

function parametroInvalido(mensagem: string) {
  return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem }, { status: 400 });
}

/** AC-389: os quatro cartões do topo do funil, só com dados da empresa da sessão. */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { searchParams } = request.nextUrl;
  const visao = searchParams.get('visao');

  if (visao === 'funil') {
    const indicadores = await obterIndicadoresFunil(getDb(), contexto, { agora: new Date() });
    return NextResponse.json(indicadores);
  }

  if (visao === 'arquivados') {
    const de = searchParams.get('de') ?? undefined;
    const ate = searchParams.get('ate') ?? undefined;
    if (de !== undefined && !FORMATO_DATA.test(de)) {
      return parametroInvalido(`Data inicial "${de}" inválida. Use o formato AAAA-MM-DD.`);
    }
    if (ate !== undefined && !FORMATO_DATA.test(ate)) {
      return parametroInvalido(`Data final "${ate}" inválida. Use o formato AAAA-MM-DD.`);
    }
    if (de !== undefined && ate !== undefined && de > ate) {
      return parametroInvalido('A data inicial não pode ser depois da data final.');
    }

    const indicadores = await obterIndicadoresArquivados(getDb(), contexto, { de, ate, agora: new Date() });
    return NextResponse.json(indicadores);
  }

  return parametroInvalido('Use "visao=funil" ou "visao=arquivados".');
}

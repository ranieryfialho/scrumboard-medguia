// T-220 (fase5-metas, AC-615 a AC-620): `GET` devolve as metas da empresa da sessão (qualquer
// papel — alimenta os selos dos indicadores, ASM-215); `PUT` grava ou remove metas (gerente+).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import { exigirGerente } from '../../../lib/equipe/acesso';
import { ehChaveMeta, metaValida, unidadeDaMeta, type ChaveMeta } from '../../../lib/metas/catalogo';
import { comoMapa, gravarMetas, lerMetas } from '../../../repositories/metas';

export const dynamic = 'force-dynamic';

async function sessao(request: NextRequest): Promise<ContextoTenant | null> {
  const s = await getAuth().api.getSession({ headers: request.headers });
  if (!s) return null;
  try {
    return await resolverContextoTenant(getDb(), { token: s.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

export async function GET(request: NextRequest) {
  const contexto = await sessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const metas = await lerMetas(getDb(), contexto);
  return NextResponse.json({ metas: comoMapa(metas), detalhes: metas });
}

export async function PUT(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as { metas?: Record<string, unknown> } | null;
  if (!corpo?.metas || typeof corpo.metas !== 'object') {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem: 'Informe as metas.' }, { status: 400 });
  }
  const alteracoes: Partial<Record<ChaveMeta, number | null>> = {};
  for (const [chave, valor] of Object.entries(corpo.metas)) {
    if (!ehChaveMeta(chave)) {
      return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: chave, mensagem: 'Meta desconhecida.' }, { status: 400 });
    }
    if (valor === null) alteracoes[chave] = null;
    else if (metaValida(chave, valor)) alteracoes[chave] = valor;
    else {
      const mensagem = unidadeDaMeta(chave) === 'reais' ? 'A meta de receita deve ser um valor em reais de R$ 0,01 a R$ 99.999.999,99, com até duas casas.' : 'A meta deve ser um número de 0,1 a 100.';
      return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: chave, mensagem }, { status: 400 });
    }
  }
  await gravarMetas(getDb(), acesso.contexto, alteracoes);
  const metas = await lerMetas(getDb(), acesso.contexto);
  return NextResponse.json({ metas: comoMapa(metas), detalhes: metas });
}

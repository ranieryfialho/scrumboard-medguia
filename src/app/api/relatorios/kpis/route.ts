// T-102 (fase2d-kpis, US-062): rota GET /api/relatorios/kpis — expõe o
// repositório de T-101 (`obterKpis`). Mesmo padrão de sessão/tenant das
// demais rotas da feature (src/app/api/atividades/route.ts,
// src/app/api/whatsapp/config/route.ts): 401 sem sessão, 403 fora do papel
// permitido (ASM-074: só MASTER, GERENTE e super admin — AC-229), 400 se os
// parâmetros forem inválidos, sem tocar o banco (AC-230). O `empresaId` do
// isolamento (AC-228) vem só da sessão/RLS — a rota nunca lê `empresaId` da
// query.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { obterKpis } from '../../../../repositories/kpis';

export const dynamic = 'force-dynamic';

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function parametroInvalido(mensagem: string) {
  return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem }, { status: 400 });
}

/** ASM-074: só MASTER, GERENTE e super admin veem os indicadores (AC-229). */
function podeVerKpis(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

/** Data é uma data de calendário real (rejeita "2026-02-30", por exemplo), não só o formato. */
function dataValida(data: string): boolean {
  if (!FORMATO_DATA.test(data)) return false;
  const [ano, mes, dia] = data.split('-').map(Number);
  const instante = new Date(Date.UTC(ano, mes - 1, dia));
  return instante.getUTCFullYear() === ano && instante.getUTCMonth() === mes - 1 && instante.getUTCDate() === dia;
}

interface FiltroValidado {
  de?: string;
  ate?: string;
  responsavelId?: string;
}

/** AC-230: `de`/`ate` mal formados, `de` > `ate` ou `responsavelId` não-UUID são recusados antes de tocar o banco. */
function validarFiltro(searchParams: URLSearchParams): { ok: true; filtro: FiltroValidado } | { ok: false; mensagem: string } {
  const de = searchParams.get('de') ?? undefined;
  const ate = searchParams.get('ate') ?? undefined;
  const responsavelId = searchParams.get('responsavelId') ?? undefined;

  if (de !== undefined && !dataValida(de)) {
    return { ok: false, mensagem: `Data inicial "${de}" inválida. Use o formato AAAA-MM-DD.` };
  }
  if (ate !== undefined && !dataValida(ate)) {
    return { ok: false, mensagem: `Data final "${ate}" inválida. Use o formato AAAA-MM-DD.` };
  }
  if (de !== undefined && ate !== undefined && de > ate) {
    return { ok: false, mensagem: 'A data inicial não pode ser depois da data final.' };
  }
  if (responsavelId !== undefined && !FORMATO_UUID.test(responsavelId)) {
    return { ok: false, mensagem: `"responsavelId" inválido: "${responsavelId}" não é um identificador válido.` };
  }

  return { ok: true, filtro: { de, ate, responsavelId } };
}

/**
 * AC-226 a AC-230: calcula os indicadores do funil (US-061) para o tenant da
 * sessão, filtrados por período (padrão: mês corrente) e, opcionalmente, por
 * responsável.
 */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeVerKpis(contexto)) return semPermissao();

  const validacao = validarFiltro(request.nextUrl.searchParams);
  if (!validacao.ok) return parametroInvalido(validacao.mensagem);

  const kpis = await obterKpis(getDb(), contexto, {
    de: validacao.filtro.de,
    ate: validacao.filtro.ate,
    responsavelId: validacao.filtro.responsavelId,
    agora: new Date(),
  });

  return NextResponse.json(kpis);
}

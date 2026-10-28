// T-105 (fase2d-campanhas, US-064/US-066): rotas GET e POST /api/campanhas.
// Mesmo padrão de sessão/tenant de src/app/api/atividades/route.ts (401 →
// 403 → 400 → repositório); MASTER/GERENTE/super admin (ASM-076), ATENDENTE
// nunca acessa campanhas. `empresaId` vem só da sessão (nunca de query ou
// corpo, AC-243). Toda a regra de negócio (normalização de destinatários,
// transações) já está em src/repositories/campanhas.ts (T-104) — esta rota
// só valida o corpo e traduz o resultado/erros para o envelope HTTP.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { getAuth } from '../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../lib/auth/tenant';
import {
  criarCampanha,
  type ContatoBruto,
  type OrigemDestinatarios,
} from '../../../repositories/campanhas';
import { listarCampanhasComResumo, type FiltroStatusCampanha } from '../../../repositories/campanhas-resumo';

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

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

function semPermissao() {
  return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
}

function parametroInvalido(mensagem: string) {
  return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem }, { status: 400 });
}

/** ASM-076: MASTER, GERENTE e super admin acessam campanhas; ATENDENTE não. */
function podeAcessarCampanhas(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

interface CamposCampanha {
  nome: string;
  assunto: string;
  corpoHtml: string;
}

/** AC-238: nome, assunto e corpo são obrigatórios; mensagem de erro em português. */
function validarCamposObrigatorios(corpo: unknown): CamposCampanha | { erro: string } {
  if (!corpo || typeof corpo !== 'object') {
    return { erro: 'O corpo da requisição é inválido.' };
  }
  const { nome, assunto, corpoHtml } = corpo as Record<string, unknown>;

  if (typeof nome !== 'string' || nome.trim() === '') {
    return { erro: 'O campo nome é obrigatório.' };
  }
  if (typeof assunto !== 'string' || assunto.trim() === '') {
    return { erro: 'O campo assunto é obrigatório.' };
  }
  if (typeof corpoHtml !== 'string' || corpoHtml.trim() === '') {
    return { erro: 'O campo corpo é obrigatório.' };
  }

  return { nome, assunto, corpoHtml };
}

function contatoValido(valor: unknown): valor is ContatoBruto {
  if (!valor || typeof valor !== 'object') return false;
  const { nome, email } = valor as Record<string, unknown>;
  return typeof nome === 'string' && typeof email === 'string';
}

/** AC-234/AC-235: origem "planilha" (lista de contatos já extraída, ASM-077) ou "etapa" (ASM-078). */
function validarOrigem(corpo: unknown): OrigemDestinatarios | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const { origem } = corpo as Record<string, unknown>;
  if (!origem || typeof origem !== 'object') return null;

  const { tipo } = origem as Record<string, unknown>;

  if (tipo === 'etapas') {
    const { etapaIds } = origem as Record<string, unknown>;
    if (!Array.isArray(etapaIds) || etapaIds.length === 0 || !etapaIds.every((id) => typeof id === 'number' && Number.isInteger(id))) return null;
    return { tipo: 'etapas', etapaIds: [...new Set(etapaIds as number[])] };
  }

  if (tipo === 'planilha') {
    const { contatos } = origem as Record<string, unknown>;
    if (!Array.isArray(contatos) || !contatos.every(contatoValido)) return null;
    return { tipo: 'planilha', contatos };
  }

  if (tipo === 'etapa') {
    const { etapaId } = origem as Record<string, unknown>;
    if (typeof etapaId !== 'number' || !Number.isInteger(etapaId)) return null;
    return { tipo: 'etapa', etapaId };
  }

  return null;
}

const FILTROS_DE_STATUS: readonly FiltroStatusCampanha[] = ['rascunho', 'enviando', 'concluida'];
const FILTROS_DE_DIAS = [7, 30, 90];

/**
 * AC-243/AC-533/AC-534: campanhas do tenant da sessão, da mais nova para a mais antiga, com as
 * contagens por status e os indicadores. `status`, `busca`, `dias`, `pagina` e `porPagina` são
 * opcionais; sem eles devolve todas, como antes.
 */
export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const p = request.nextUrl.searchParams;
  const status = p.get('status');
  if (status && !FILTROS_DE_STATUS.includes(status as FiltroStatusCampanha)) return parametroInvalido('O filtro de status é inválido.');
  const dias = p.get('dias') ? Number(p.get('dias')) : undefined;
  if (dias !== undefined && !FILTROS_DE_DIAS.includes(dias)) return parametroInvalido('O filtro de dias é inválido.');
  const pagina = p.get('pagina') ? Number(p.get('pagina')) : undefined;
  const porPagina = p.get('porPagina') ? Number(p.get('porPagina')) : undefined;
  if (
    (pagina !== undefined && (!Number.isInteger(pagina) || pagina < 1)) ||
    (porPagina !== undefined && (!Number.isInteger(porPagina) || porPagina < 1 || porPagina > 100))
  ) {
    return parametroInvalido('A paginação é inválida.');
  }

  const lista = await listarCampanhasComResumo(getDb(), contexto, {
    status: (status as FiltroStatusCampanha | null) ?? undefined,
    busca: p.get('busca') ?? undefined,
    dias,
    pagina,
    porPagina,
    agora: new Date(),
  });

  return NextResponse.json({
    campanhas: lista.itens.map(({ campanha, totalDestinatarios, contagens }) => ({
      id: campanha.id,
      nome: campanha.nome,
      assunto: campanha.assunto,
      status: campanha.status,
      totalDestinatarios,
      criadoEm: campanha.criadoEm,
      contagens,
    })),
    total: lista.total,
    resumo: lista.resumo,
  });
}

/** AC-234/AC-235/AC-238: cria a campanha em RASCUNHO com os destinatários da origem escolhida. */
export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const corpoBruto = await request.json().catch(() => null);

  const campos = validarCamposObrigatorios(corpoBruto);
  if ('erro' in campos) return parametroInvalido(campos.erro);

  const origem = validarOrigem(corpoBruto);
  if (!origem) return parametroInvalido('A origem dos destinatários é inválida.');

  const resultado = await criarCampanha(getDb(), contexto, {
    nome: campos.nome,
    assunto: campos.assunto,
    corpoHtml: campos.corpoHtml,
    criadoPor: contexto.usuarioId,
    origem,
  });

  return NextResponse.json(
    {
      id: resultado.campanha.id,
      totalDestinatarios: resultado.totalDestinatarios,
      descartadosInvalidos: resultado.descartadosInvalidos,
      descartadosRepetidos: resultado.descartadosRepetidos,
    },
    { status: 201 }
  );
}

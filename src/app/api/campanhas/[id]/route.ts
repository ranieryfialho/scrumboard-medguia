// T-105 (fase2d-campanhas, US-064/US-066): rotas GET, PATCH e DELETE
// /api/campanhas/:id. GET (AC-244) e DELETE (AC-245) usam
// src/repositories/campanhas.ts (T-104) direto. A edição (PATCH, AC-237) não
// tem repositório próprio — como src/app/api/oportunidades/[id]/route.ts,
// usa `comTenant` direto nesta rota para o UPDATE condicional por status
// (só RASCUNHO é editável; as outras voltam 409 sem gravar nada).
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { campanhas, usuarios } from '../../../../db/schema';
import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { comTenant } from '../../../../repositories/contexto';
import {
  buscarDetalheCampanha,
  excluirCampanha,
  ErroCampanhaEmEnvio,
  ErroCampanhaNaoEncontrada,
  type Campanha,
  type EnvioCampanha,
} from '../../../../repositories/campanhas';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function campanhaNaoEncontrada() {
  return NextResponse.json({ codigo: 'CAMPANHA_NAO_ENCONTRADA' }, { status: 404 });
}

function parametroInvalido(mensagem: string) {
  return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem }, { status: 400 });
}

/** ASM-076: MASTER, GERENTE e super admin acessam campanhas; ATENDENTE não. */
function podeAcessarCampanhas(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

function campanhaParaJson(campanha: Campanha) {
  return {
    id: campanha.id,
    nome: campanha.nome,
    assunto: campanha.assunto,
    corpoHtml: campanha.corpoHtml,
    status: campanha.status,
    criadoPor: campanha.criadoPor,
    criadoEm: campanha.criadoEm,
  };
}

function destinatarioParaJson(destinatario: EnvioCampanha) {
  return {
    id: destinatario.id,
    nome: destinatario.nomeDestinatario,
    email: destinatario.emailDestinatario,
    status: destinatario.status,
    tentativas: destinatario.tentativas,
    enviadoEm: destinatario.enviadoEm,
  };
}

interface CamposCampanha {
  nome: string;
  assunto: string;
  corpoHtml: string;
}

/** AC-238 (reaplicado em AC-237): nome, assunto e corpo são obrigatórios; mensagem em português. */
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

/** AC-244: detalhe com destinatários ordenados por nome e a contagem por status (ou finaliza, AC-242). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const { id } = await params;
  if (!UUID.test(id)) return campanhaNaoEncontrada();

  try {
    const detalhe = await buscarDetalheCampanha(getDb(), contexto, id);
    // AC-547: o nome de quem criou a campanha (usuários não têm RLS por empresa).
    const [criador] = detalhe.campanha.criadoPor
      ? await getDb().select({ nome: usuarios.nome }).from(usuarios).where(eq(usuarios.id, detalhe.campanha.criadoPor)).limit(1)
      : [];
    return NextResponse.json({
      campanha: { ...campanhaParaJson(detalhe.campanha), criadoPorNome: criador?.nome ?? null },
      destinatarios: detalhe.destinatarios.map(destinatarioParaJson),
      contagemPorStatus: detalhe.contagemPorStatus,
    });
  } catch (erro) {
    if (erro instanceof ErroCampanhaNaoEncontrada) return campanhaNaoEncontrada();
    throw erro;
  }
}

/** AC-237: edita nome/assunto/corpo só enquanto a campanha é RASCUNHO; as demais voltam 409 sem gravar nada. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const { id } = await params;
  if (!UUID.test(id)) return campanhaNaoEncontrada();

  const corpoBruto = await request.json().catch(() => null);
  const campos = validarCamposObrigatorios(corpoBruto);
  if ('erro' in campos) return parametroInvalido(campos.erro);

  const resultado = await comTenant(getDb(), contexto, async (tx) => {
    const [existente] = await tx
      .select({ status: campanhas.status })
      .from(campanhas)
      .where(and(eq(campanhas.id, id), eq(campanhas.empresaId, contexto.empresaId)))
      .limit(1);
    if (!existente) return { tipo: 'nao-encontrada' as const };
    if (existente.status !== 'RASCUNHO') return { tipo: 'nao-editavel' as const };

    const [atualizada] = await tx
      .update(campanhas)
      .set({ nome: campos.nome, assunto: campos.assunto, corpoHtml: campos.corpoHtml })
      .where(
        and(eq(campanhas.id, id), eq(campanhas.empresaId, contexto.empresaId), eq(campanhas.status, 'RASCUNHO'))
      )
      .returning();

    return { tipo: 'ok' as const, campanha: atualizada };
  });

  if (resultado.tipo === 'nao-encontrada') return campanhaNaoEncontrada();
  if (resultado.tipo === 'nao-editavel') {
    return NextResponse.json({ codigo: 'CAMPANHA_NAO_EDITAVEL' }, { status: 409 });
  }

  return NextResponse.json(campanhaParaJson(resultado.campanha));
}

/** AC-245: exclui a campanha e seus destinatários; PROCESSANDO não pode ser excluída. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAcessarCampanhas(contexto)) return semPermissao();

  const { id } = await params;
  if (!UUID.test(id)) return campanhaNaoEncontrada();

  try {
    await excluirCampanha(getDb(), contexto, id);
  } catch (erro) {
    if (erro instanceof ErroCampanhaNaoEncontrada) return campanhaNaoEncontrada();
    if (erro instanceof ErroCampanhaEmEnvio) {
      return NextResponse.json({ codigo: 'CAMPANHA_EM_ENVIO' }, { status: 409 });
    }
    throw erro;
  }

  return new NextResponse(null, { status: 204 });
}

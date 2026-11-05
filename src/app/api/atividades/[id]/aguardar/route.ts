// Cadência: marca um toque de WhatsApp como "aguardando resposta" (a mensagem saiu e o lead ainda não respondeu). Mesmo padrão de sessão,
// tenant, papel e versão da rota `concluir` (401 → 400 → 404 → 403 → 409/422); o toque continua `pendente` e ganha um prazo, vencido o
// qual o cron conclui como `sem_resposta`.
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { cadenciaAtividades, oportunidades } from '../../../../../db/schema';
import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { comTenant } from '../../../../../repositories/contexto';
import {
  ErroBlocoAnteriorPendente,
  ErroCadenciaEncerrada,
  ErroConflitoDeVersao,
  ErroToqueNaoAceitaAguardar,
  marcarAguardandoResposta,
} from '../../../../../repositories/cadencia';

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

interface CorpoAguardar {
  version: number;
}

function corpoValido(corpo: unknown): corpo is CorpoAguardar {
  if (!corpo || typeof corpo !== 'object') return false;
  return typeof (corpo as Record<string, unknown>).version === 'number';
}

/** ASM-061: MASTER, GERENTE e super admin concluem qualquer card do tenant; ATENDENTE só os próprios. */
function podeConcluirQualquerCard(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

interface AtividadeComResponsavel {
  responsavelId: string | null;
}

/**
 * Busca o toque no tenant do `contexto`, trazendo o `responsavelId` do card
 * para a checagem de papel (ASM-061). RLS filtra toques de outra empresa —
 * "não existe" para quem chama, igual ao padrão de `buscarOportunidadePorId`
 * (AC-198).
 */
async function buscarAtividadeComResponsavel(
  contexto: ContextoTenant,
  atividadeId: string
): Promise<AtividadeComResponsavel | null> {
  return comTenant(getDb(), contexto, async (tx) => {
    const linhas = await tx
      .select({ responsavelId: oportunidades.responsavelId })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .where(and(eq(cadenciaAtividades.id, atividadeId), eq(cadenciaAtividades.empresaId, contexto.empresaId)))
      .limit(1);
    return linhas[0] ?? null;
  });
}

/** Marca o toque como aguardando resposta, respeitando papel, estado, tenant e versão. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const atividade = await buscarAtividadeComResponsavel(contexto, id);
  if (!atividade) {
    return NextResponse.json({ codigo: 'ATIVIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  if (!podeConcluirQualquerCard(contexto) && atividade.responsavelId !== contexto.usuarioId) {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  try {
    const marcada = await marcarAguardandoResposta(getDb(), contexto, id, { version: corpo.version, atorId: contexto.usuarioId, agora: new Date() });
    return NextResponse.json(marcada);
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) return NextResponse.json({ codigo: 'CONFLITO_DE_VERSAO' }, { status: 409 });
    if (erro instanceof ErroBlocoAnteriorPendente) return NextResponse.json({ codigo: 'BLOCO_ANTERIOR_PENDENTE' }, { status: 422 });
    if (erro instanceof ErroCadenciaEncerrada) return NextResponse.json({ codigo: 'CADENCIA_ENCERRADA' }, { status: 422 });
    if (erro instanceof ErroToqueNaoAceitaAguardar) return NextResponse.json({ codigo: 'TOQUE_NAO_ACEITA_AGUARDAR' }, { status: 422 });
    throw erro;
  }
}

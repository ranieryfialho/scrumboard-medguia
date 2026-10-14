// T-092 (fase2b-cadencia, US-054): rota que conclui um toque da cadência
// (AC-193: `sem_resposta` registra o fato; AC-194: o terceiro `sem_resposta`
// do bloco libera o seguinte; AC-195: `conectou` encerra a cadência na
// hora). Mesmo padrão de sessão/tenant/versão das demais rotas da feature
// (401 → 404 → 409): a diferença é que aqui o "404" é sobre o toque, não
// sobre o card (AC-198), e existe um terceiro portão entre o 404 e a
// chamada ao repositório — o papel (ASM-061: ATENDENTE só conclui toques de
// cards dos quais é responsável; MASTER, GERENTE e super admin concluem
// qualquer um do tenant).
//
// A regra de ordem/turno (AC-196) e de estado (AC-197) é toda da função SQL
// `concluir_atividade_cadencia` (T-089), chamada por `concluirAtividade`
// (T-090) — esta rota só traduz os erros tipados que o repositório já
// levanta (`ErroConflitoDeVersao`, `ErroTurnoNaoLiberado`,
// `ErroBlocoAnteriorPendente`, `ErroCadenciaEncerrada`) no envelope do TDD
// §4.6.
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { cadenciaAtividades, oportunidades } from '../../../../../db/schema';
import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { comTenant } from '../../../../../repositories/contexto';
import {
  concluirAtividade,
  ErroBlocoAnteriorPendente,
  ErroCadenciaEncerrada,
  ErroConflitoDeVersao,
  ErroTurnoNaoLiberado,
  type ResultadoToque,
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

interface CorpoConcluir {
  version: number;
  resultado: ResultadoToque;
}

function corpoValido(corpo: unknown): corpo is CorpoConcluir {
  if (!corpo || typeof corpo !== 'object') return false;
  const { version, resultado } = corpo as Record<string, unknown>;
  return typeof version === 'number' && (resultado === 'sem_resposta' || resultado === 'conectou');
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

/** AC-193 a AC-198: conclui o toque (ou recusa) respeitando papel, ordem/turno, estado, tenant e versão. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  // AC-198: toque de outro tenant (ou inexistente) "não existe" do ponto de
  // vista do chamador — 404 antes de validar papel ou chamar o repositório.
  const atividade = await buscarAtividadeComResponsavel(contexto, id);
  if (!atividade) {
    return NextResponse.json({ codigo: 'ATIVIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  if (!podeConcluirQualquerCard(contexto) && atividade.responsavelId !== contexto.usuarioId) {
    return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  }

  try {
    const concluida = await concluirAtividade(getDb(), contexto, id, {
      version: corpo.version,
      resultado: corpo.resultado,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      agora: new Date(),
    });
    return NextResponse.json(concluida);
  } catch (erro) {
    if (erro instanceof ErroConflitoDeVersao) {
      return NextResponse.json({ codigo: 'CONFLITO_DE_VERSAO' }, { status: 409 });
    }
    if (erro instanceof ErroTurnoNaoLiberado) {
      return NextResponse.json({ codigo: 'TURNO_NAO_LIBERADO' }, { status: 422 });
    }
    if (erro instanceof ErroBlocoAnteriorPendente) {
      return NextResponse.json({ codigo: 'BLOCO_ANTERIOR_PENDENTE' }, { status: 422 });
    }
    if (erro instanceof ErroCadenciaEncerrada) {
      return NextResponse.json({ codigo: 'CADENCIA_ENCERRADA' }, { status: 422 });
    }
    throw erro;
  }
}

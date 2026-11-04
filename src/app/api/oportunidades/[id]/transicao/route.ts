// T-047 (fase2-kanban, US-031): única rota que move um card de etapa. Fluxo:
// resolve sessão (401) → busca o card no tenant (404 se não existir — AC-087,
// fail closed, antes de validar qualquer coisa) → carrega etapa destino e o
// recorte do grafo a partir da etapa de origem → `validarTransicao`
// (domínio, síncrono; fase1-dominio-pipeline) → se `!ok`, 422 com o `codigo`
// do domínio, sem tocar a escrita → se `ok`, `moverOportunidade` (fase2,
// T-045), que grava tudo atomicamente; conflito de versão (lock otimista)
// vira 409 (ASM-021).
//
// T-057 (fase2c-anexos, US-036): `anexoId` só conta como evidência se o anexo
// existe no tenant E foi enviado para este mesmo card (AC-106); qualquer outro
// valor é tratado como ausente, então o domínio responde EVIDENCIA_OBRIGATORIA.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import { lerFechamento } from '../../../../../domain/pipeline/fechamento';
import { salvarFechamentoDoCard } from '../../../../../repositories/fechamento-card';
import { transicionarCard } from '../../../../../repositories/transicao-card';

const ETAPA_CONTRATO_GANHO = 15;

export const dynamic = 'force-dynamic';

/** AC-078 (mesmo padrão da rota do board): resolve o `ContextoTenant`, ou `null` sem tocar em nenhuma tabela de negócio. */
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

interface CorpoTransicao {
  version: number;
  etapaDestinoId: number;
  valor?: number | null;
  motivoPerdaId?: string | null;
  proximaAcaoEm?: string | null;
  anexoId?: string | null;
  justificativa?: string | null;
  fechamento?: unknown;
}

function corpoValido(corpo: unknown): corpo is CorpoTransicao {
  if (!corpo || typeof corpo !== 'object') return false;
  const { version, etapaDestinoId } = corpo as Record<string, unknown>;
  return typeof version === 'number' && typeof etapaDestinoId === 'number';
}

/** AC-082 a AC-087: move o card respeitando grafo, papel e dados obrigatórios da etapa de destino. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpoValido(corpo)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  // T-176: a regra inteira (404 fail closed, grafo, papel, dados obrigatórios,
  // lock otimista) vive em `transicionarCard`, a mesma dos lotes.
  // T-313: ao ir para "Contrato (Ganho)" a tela manda os dados do fechamento; malformado é 400 antes de mover o card.
  const bruto = (corpo as { fechamento?: unknown }).fechamento;
  const fechamento = bruto === undefined || bruto === null ? null : lerFechamento(bruto);
  if (bruto !== undefined && bruto !== null && !fechamento) return NextResponse.json({ codigo: 'FECHAMENTO_INVALIDO' }, { status: 400 });

  const resultado = await transicionarCard(getDb(), contexto, id, corpo);

  if (resultado.ok) {
    // O card já está no Ganho; se gravar o fechamento falhar, a pessoa preenche no detalhe do card (o movimento não se desfaz).
    if (fechamento && corpo.etapaDestinoId === ETAPA_CONTRATO_GANHO) await salvarFechamentoDoCard(getDb(), contexto, id, fechamento).catch(() => false);
    return NextResponse.json(resultado.card);
  }
  if (resultado.codigo === 'OPORTUNIDADE_NAO_ENCONTRADA') {
    return NextResponse.json({ codigo: resultado.codigo }, { status: 404 });
  }
  if (resultado.codigo === 'CONFLITO_DE_VERSAO') {
    return NextResponse.json({ codigo: resultado.codigo }, { status: 409 });
  }
  if (resultado.codigo === 'MOTIVO_INVALIDO') {
    return NextResponse.json({ codigo: resultado.codigo }, { status: 400 }); // fase5-motivos-por-empresa, AC-665
  }
  return NextResponse.json({ codigo: resultado.codigo }, { status: 422 });
}

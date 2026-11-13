// T-048 (fase2-kanban, US-033): detalhe de um card. Usa
// `buscarOportunidadePorId` (fase1-repositorios-isolamento, já fail-closed
// por AC-069 — id de outro tenant "não existe") + três lookups simples pra
// nome do lead, do responsável e do motivo de perda (quando houver).
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { leads, motivosPerda, usuarios } from '../../../../db/schema';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { comTenant } from '../../../../repositories/contexto';
import {
  editarCard,
  ErroCampoInvalido,
  ErroCardNaoEncontrado,
  ErroTelefoneDeOutroLead,
  ErroValorObrigatorioNaProposta,
} from '../../../../repositories/edicao-card';
import { buscarOportunidadePorId } from '../../../../repositories/oportunidades';
import { lerPerdaDoCard } from '../../../../repositories/perda-do-card';
import { obterProximaAcaoDoCard } from '../../../../repositories/proxima-acao-card';

export const dynamic = 'force-dynamic';

/** AC-078 (mesmo padrão das demais rotas de /api/oportunidades): resolve o `ContextoTenant`, ou `null` sem tocar em nenhuma tabela de negócio. */
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

/** Um texto de `leads.dados` (jsonb livre): só string não vazia, senão `null`. */
function textoDosDados(dados: unknown, chave: string): string | null {
  if (!dados || typeof dados !== 'object') return null;
  const valor = (dados as Record<string, unknown>)[chave];
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/** AC-092/AC-093: detalhe do card, fail closed pra outro tenant. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const oportunidade = await buscarOportunidadePorId(getDb(), contexto, id);
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  const db = getDb();
  const [lead, responsavelNome, motivoPerdaNome, perda] = await comTenant(db, contexto, async (tx) => {
    const [lead] = await tx
      .select({ nome: leads.nome, email: leads.email, origem: leads.origem, telefoneE164: leads.telefoneE164, dados: leads.dados })
      .from(leads)
      .where(and(eq(leads.id, oportunidade.leadId), eq(leads.empresaId, contexto.empresaId)))
      .limit(1);

    const [responsavel] = oportunidade.responsavelId
      ? await tx.select({ nome: usuarios.nome }).from(usuarios).where(eq(usuarios.id, oportunidade.responsavelId)).limit(1)
      : [];

    const [motivo] = oportunidade.motivoPerdaId
      ? await tx.select({ nome: motivosPerda.nome }).from(motivosPerda).where(eq(motivosPerda.id, oportunidade.motivoPerdaId)).limit(1)
      : [];

    // fase6-perdas-por-lead (AC-813/AC-814): o bloco "Perda" só existe para card que está em Perdido agora (reaberto não tem).
    const perda = await lerPerdaDoCard(tx, contexto.empresaId, oportunidade, motivo?.nome ?? null);

    return [lead ?? null, responsavel?.nome ?? null, motivo?.nome ?? null, perda] as const;
  });

  // A próxima ação que o card mostra: reunião marcada, toque da cadência ou a data combinada, conforme a etapa.
  const proximaAcao = await obterProximaAcaoDoCard(db, contexto, oportunidade, new Date());

  return NextResponse.json({
    id: oportunidade.id,
    etapaId: oportunidade.etapaId,
    leadId: oportunidade.leadId,
    leadNome: lead?.nome ?? '',
    // T-163 (fase4-pipeline-telas, AC-407): origem/e-mail do lead e a data de
    // entrada do card (quando foi criado) para o bloco "Informações
    // Principais" do detalhe — nenhum consumidor anterior desta rota lia
    // esses campos, então são só acrescentados, sem quebrar o contrato.
    origem: lead?.origem ?? null,
    // Dados do formulário/anúncio que vieram com o lead (`leads.dados`): o que o time precisa ver no card.
    especialidade: textoDosDados(lead?.dados, 'especialidade'),
    anuncio: textoDosDados(lead?.dados, 'anuncio'),
    campanha: textoDosDados(lead?.dados, 'campanha'),
    formulario: textoDosDados(lead?.dados, 'formulario'),
    plataforma: textoDosDados(lead?.dados, 'plataforma'),
    email: lead?.email ?? null,
    // T-231 (fase5-acoes-rapidas, AC-645): telefone principal, para o link "Ligar Agora".
    telefoneE164: lead?.telefoneE164 ?? null,
    criadoEm: oportunidade.criadoEm.toISOString(),
    responsavelId: oportunidade.responsavelId,
    responsavelNome,
    valor: oportunidade.valor,
    motivoPerdaId: oportunidade.motivoPerdaId,
    motivoPerdaNome,
    // fase6-perdas-por-lead: motivo, etapa em que estava, quando e se foi automática; `null` fora de "Perdido".
    perda,
    proximaAcaoEm: oportunidade.proximaAcaoEm,
    proximaAcao,
    version: oportunidade.version,
  });
}

/** AC-736/AC-737: edita nome, e-mail, origem, telefone principal e valor do card; só grava (e registra na linha do tempo) o que mudou. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id } = await params;
  const corpo = await request.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return NextResponse.json({ codigo: 'CORPO_INVALIDO' }, { status: 400 });
  }
  const { nome, email, origem, telefone, valor, especialidade } = corpo as Record<string, unknown>;

  const oportunidade = await buscarOportunidadePorId(getDb(), contexto, id);
  if (!oportunidade) {
    return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
  }

  try {
    const alteracoes = await editarCard(getDb(), contexto, id, { nome, email, origem, telefone, valor, especialidade });
    return NextResponse.json({ alteracoes });
  } catch (erro) {
    if (erro instanceof ErroCampoInvalido) return NextResponse.json({ codigo: 'CAMPO_INVALIDO', campo: erro.campo }, { status: 400 });
    if (erro instanceof ErroValorObrigatorioNaProposta) {
      return NextResponse.json({ codigo: 'VALOR_OBRIGATORIO_NA_PROPOSTA', campo: 'valor' }, { status: 422 });
    }
    if (erro instanceof ErroTelefoneDeOutroLead) return NextResponse.json({ codigo: 'TELEFONE_DUPLICADO', campo: 'telefone' }, { status: 409 });
    if (erro instanceof ErroCardNaoEncontrado) return NextResponse.json({ codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' }, { status: 404 });
    throw erro;
  }
}

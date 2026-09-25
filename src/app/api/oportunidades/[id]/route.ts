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
import { buscarOportunidadePorId } from '../../../../repositories/oportunidades';

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
  const [leadNome, responsavelNome, motivoPerdaNome] = await comTenant(db, contexto, async (tx) => {
    const [lead] = await tx
      .select({ nome: leads.nome })
      .from(leads)
      .where(and(eq(leads.id, oportunidade.leadId), eq(leads.empresaId, contexto.empresaId)))
      .limit(1);

    const [responsavel] = oportunidade.responsavelId
      ? await tx.select({ nome: usuarios.nome }).from(usuarios).where(eq(usuarios.id, oportunidade.responsavelId)).limit(1)
      : [];

    const [motivo] = oportunidade.motivoPerdaId
      ? await tx.select({ nome: motivosPerda.nome }).from(motivosPerda).where(eq(motivosPerda.id, oportunidade.motivoPerdaId)).limit(1)
      : [];

    return [lead?.nome ?? '', responsavel?.nome ?? null, motivo?.nome ?? null] as const;
  });

  return NextResponse.json({
    id: oportunidade.id,
    etapaId: oportunidade.etapaId,
    leadId: oportunidade.leadId,
    leadNome,
    responsavelId: oportunidade.responsavelId,
    responsavelNome,
    valor: oportunidade.valor,
    motivoPerdaId: oportunidade.motivoPerdaId,
    motivoPerdaNome,
    proximaAcaoEm: oportunidade.proximaAcaoEm,
    version: oportunidade.version,
  });
}

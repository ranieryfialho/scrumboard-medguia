// T-293 (fase4-card-abas, US-112, AC-750/AC-751): o que a rota do dossiê precisa de um card — os anexos com o caminho do arquivo
// no volume, o nome do lead e o registro de que o dossiê foi exportado. Mesmo padrão `comTenant` das demais listagens: o card de
// outra empresa é tratado pela rota (404, fail-closed) antes de chamar este repositório.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { anexos, leads, oportunidadeEventos, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { listarAnexosDoCard, type AnexoDoCard } from './anexos-lista';

export const TIPO_EVENTO_DOSSIE = 'dossie_exportado';

export interface AnexoParaDossie extends AnexoDoCard {
  caminho: string;
}

export async function listarAnexosParaDossie(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string): Promise<AnexoParaDossie[]> {
  const lista = await listarAnexosDoCard(db, contexto, oportunidadeId);
  if (lista.length === 0) return [];
  const caminhos = await comTenant(db, contexto, (tx) =>
    tx
      .select({ id: anexos.id, caminho: anexos.caminho })
      .from(anexos)
      .where(and(eq(anexos.oportunidadeId, oportunidadeId), eq(anexos.empresaId, contexto.empresaId)))
  );
  const porId = new Map(caminhos.map((c) => [c.id, c.caminho]));
  return lista.flatMap((anexo) => {
    const caminho = porId.get(anexo.id);
    return caminho ? [{ ...anexo, caminho }] : [];
  });
}

export async function nomeDoLeadDoCard(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string): Promise<string> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({ nome: leads.nome })
      .from(oportunidades)
      .innerJoin(leads, eq(leads.id, oportunidades.leadId))
      .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    return linha?.nome ?? '';
  });
}

/** AC-751: fica na linha do tempo quem exportou, quando, e quantos arquivos iam no dossiê (dado pessoal saiu do sistema). */
export async function registrarDossieExportado(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  resumo: { arquivos: number; divergentes: number; ausentes: number }
): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId,
      tipo: TIPO_EVENTO_DOSSIE,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: resumo,
    });
  });
}

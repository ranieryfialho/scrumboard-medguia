// T-156 (fase4-pipeline-telas, US-109, AC-409): registra uma anotação
// interna como mais um evento em `oportunidade_eventos` — mesmo log
// append-only já usado por `moverOportunidade` para `transicao_etapa`
// (ASM-139: `tipo` é texto livre, então "anotacao" não exige migration).
// O texto fica no `payload` (jsonb); autor e instante reaproveitam as
// colunas `ator_id`/`ator_tipo`/`ocorrido_em` que já existem. Mesmo padrão
// `comTenant` (T-040) dos demais repositórios: a oportunidade de outro
// tenant (ou inexistente) é tratada pela rota (404, fail-closed) antes de
// chamar este repositório.
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { oportunidadeEventos, usuarios } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export const TIPO_EVENTO_ANOTACAO = 'anotacao';

export interface DadosAnotacao {
  texto: string;
}

export interface Anotacao {
  id: string;
  texto: string;
  autorId: string;
  autorNome: string | null;
  ocorridoEm: Date;
}

/** AC-409: grava a anotação como evento `anotacao`, com o autor sempre o usuário da sessão. */
export async function registrarAnotacao(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  dados: DadosAnotacao
): Promise<Anotacao> {
  return comTenant(db, contexto, async (tx) => {
    const [evento] = await tx
      .insert(oportunidadeEventos)
      .values({
        empresaId: contexto.empresaId,
        oportunidadeId,
        tipo: TIPO_EVENTO_ANOTACAO,
        atorId: contexto.usuarioId,
        atorTipo: 'usuario',
        payload: { texto: dados.texto },
      })
      .returning();

    const [autor] = await tx
      .select({ nome: usuarios.nome })
      .from(usuarios)
      .where(eq(usuarios.id, contexto.usuarioId))
      .limit(1);

    return {
      id: evento.id,
      texto: dados.texto,
      autorId: contexto.usuarioId,
      autorNome: autor?.nome ?? null,
      ocorridoEm: evento.ocorridoEm,
    };
  });
}

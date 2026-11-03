// T-294 (fase4-card-abas, US-112, AC-752 a AC-755): tornar um anexo evidência da etapa em que o card está, desfazer isso, e excluir o
// anexo. Tudo deixa um evento na linha do tempo do card (log append-only): quem fez, quando e qual anexo — na exclusão, com o nome,
// o tipo, o tamanho e o SHA-256 do que saiu, porque o arquivo em si deixa de existir.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { anexos, oportunidadeEventos, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { ehGestor } from '../lib/auth/sessao';
import { comTenant } from './contexto';
import { listarAnexosDoCard, TIPO_EVIDENCIA_MARCADA, TIPO_EVIDENCIA_REMOVIDA } from './anexos-lista';
import { buscarAnexoPorId } from './anexos';

export const TIPO_EVENTO_ANEXO_EXCLUIDO = 'anexo_excluido';

export type ResultadoDaGestao<T = object> = ({ ok: true } & T) | { ok: false; codigo: 'ANEXO_NAO_ENCONTRADO' | 'SEM_PERMISSAO' | 'ANEXO_E_EVIDENCIA' };

/** `true` quando o usuário pode excluir o anexo: gestor exclui qualquer um, os demais só o que eles mesmos enviaram. */
export function podeExcluirAnexo(contexto: ContextoTenant, enviadoPorId: string | null): boolean {
  return ehGestor(contexto) || (enviadoPorId !== null && enviadoPorId === contexto.usuarioId);
}

async function evidenciaAtual(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string, anexoId: string) {
  const lista = await listarAnexosDoCard(db, contexto, oportunidadeId);
  return lista.find((anexo) => anexo.id === anexoId)?.evidencia ?? null;
}

/** AC-752: marca o anexo como evidência da etapa atual do card. Já ser evidência não muda nada (`alterado: false`). */
export async function tornarEvidencia(db: NodePgDatabase, contexto: ContextoTenant, anexoId: string): Promise<ResultadoDaGestao<{ alterado: boolean }>> {
  const anexo = await buscarAnexoPorId(db, contexto, anexoId);
  if (!anexo) return { ok: false, codigo: 'ANEXO_NAO_ENCONTRADO' };
  if (await evidenciaAtual(db, contexto, anexo.oportunidadeId, anexo.id)) return { ok: true, alterado: false };

  await comTenant(db, contexto, async (tx) => {
    const [oportunidade] = await tx
      .select({ etapaId: oportunidades.etapaId })
      .from(oportunidades)
      .where(and(eq(oportunidades.id, anexo.oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId: anexo.oportunidadeId,
      tipo: TIPO_EVIDENCIA_MARCADA,
      etapaDestinoId: oportunidade.etapaId,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { anexoId: anexo.id, nome: anexo.nome },
    });
  });
  return { ok: true, alterado: true };
}

/** AC-753: desfaz a evidência (a que veio de uma transição também: o registro da transição continua na linha do tempo). */
export async function removerEvidencia(db: NodePgDatabase, contexto: ContextoTenant, anexoId: string): Promise<ResultadoDaGestao<{ alterado: boolean }>> {
  const anexo = await buscarAnexoPorId(db, contexto, anexoId);
  if (!anexo) return { ok: false, codigo: 'ANEXO_NAO_ENCONTRADO' };
  const evidencia = await evidenciaAtual(db, contexto, anexo.oportunidadeId, anexo.id);
  if (!evidencia) return { ok: true, alterado: false };

  await comTenant(db, contexto, async (tx) => {
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId: anexo.oportunidadeId,
      tipo: TIPO_EVIDENCIA_REMOVIDA,
      etapaOrigemId: evidencia.etapaId,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { anexoId: anexo.id, nome: anexo.nome },
    });
  });
  return { ok: true, alterado: true };
}

/**
 * AC-754/AC-755: apaga o registro do anexo e devolve o `caminho` do arquivo no volume (quem chama o apaga depois). Recusa se o
 * usuário não pode (`SEM_PERMISSAO`) ou se o anexo é evidência (`ANEXO_E_EVIDENCIA`): evidência de etapa é prova da negociação e
 * só sai depois de removida como evidência.
 */
export async function excluirAnexo(db: NodePgDatabase, contexto: ContextoTenant, anexoId: string): Promise<ResultadoDaGestao<{ caminho: string }>> {
  const anexo = await buscarAnexoPorId(db, contexto, anexoId);
  if (!anexo) return { ok: false, codigo: 'ANEXO_NAO_ENCONTRADO' };
  if (!podeExcluirAnexo(contexto, anexo.enviadoPor)) return { ok: false, codigo: 'SEM_PERMISSAO' };
  if (await evidenciaAtual(db, contexto, anexo.oportunidadeId, anexo.id)) return { ok: false, codigo: 'ANEXO_E_EVIDENCIA' };

  await comTenant(db, contexto, async (tx) => {
    await tx.delete(anexos).where(and(eq(anexos.id, anexo.id), eq(anexos.empresaId, contexto.empresaId)));
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId: anexo.oportunidadeId,
      tipo: TIPO_EVENTO_ANEXO_EXCLUIDO,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { anexoId: anexo.id, nome: anexo.nome, mime: anexo.mime, tamanho: anexo.tamanho, hash: anexo.hash },
    });
  });
  return { ok: true, caminho: anexo.caminho };
}

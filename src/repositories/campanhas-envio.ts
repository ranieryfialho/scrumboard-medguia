// T-265 (fase5-email-disparo, US-171, AC-701/AC-703..AC-707/AC-722): o que o worker de e-mail faz no banco. Sempre por
// `comTenant` (RLS). `enviado_em` guarda o instante em que o worker PEGOU o envio enquanto ele está `ENVIANDO` (é a base
// do AC-707: não há coluna de "atualizado em") e vira o horário real quando o envio sai. Estados são texto (ASM-263).
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { campanhas, enviosCampanha } from '../db/schema';
import { emailsDescadastrados } from './email-descadastros';
import { normalizarEmail } from '../lib/email/descadastro-token';
import { comTenant } from './contexto';

export const ENVIOS_POR_CICLO = 10;
export const MINUTOS_PARA_CONSIDERAR_INTERROMPIDO = 10;

export interface EnvioParaEnviar {
  id: string;
  campanhaId: string;
  nome: string;
  email: string;
  assunto: string;
  corpoHtml: string;
}

export interface EnviosPegos {
  paraEnviar: EnvioParaEnviar[];
  descadastrados: number;
}

/**
 * AC-701/AC-705/AC-722: pega até `limite` envios `PENDENTE` das campanhas `PROCESSANDO` da empresa e os marca `ENVIANDO` na
 * mesma transação (`FOR UPDATE SKIP LOCKED`: dois ciclos nunca pegam o mesmo envio). Quem a empresa descadastrou, até depois
 * de a campanha ser criada, vira `DESCADASTRADO` aqui mesmo e não volta para o worker.
 */
export async function pegarEnvios(db: NodePgDatabase, empresaId: string, agora: Date, limite: number = ENVIOS_POR_CICLO): Promise<EnviosPegos> {
  return comTenant(db, { empresaId }, async (tx) => {
    const pegos = await tx.execute<{ id: string; campanha_id: string; nome: string; email: string }>(sql`
      WITH escolhidos AS (
        SELECT e.id FROM envios_campanha e
        JOIN campanhas c ON c.id = e.campanha_id
        WHERE e.empresa_id = ${empresaId} AND e.status = 'PENDENTE' AND c.status = 'PROCESSANDO'
        ORDER BY e.campanha_id, e.id
        LIMIT ${limite}
        FOR UPDATE OF e SKIP LOCKED
      )
      UPDATE envios_campanha e SET status = 'ENVIANDO', enviado_em = ${agora.toISOString()}::timestamptz
      FROM escolhidos WHERE e.id = escolhidos.id
      RETURNING e.id, e.campanha_id, e.nome_destinatario AS nome, e.email_destinatario AS email
    `);
    if (pegos.rows.length === 0) return { paraEnviar: [], descadastrados: 0 };

    const idsDasCampanhas = [...new Set(pegos.rows.map((p) => p.campanha_id))];
    const dadosDasCampanhas = await tx
      .select({ id: campanhas.id, assunto: campanhas.assunto, corpoHtml: campanhas.corpoHtml })
      .from(campanhas)
      .where(inArray(campanhas.id, idsDasCampanhas));
    const porId = new Map(dadosDasCampanhas.map((c) => [c.id, c]));

    const fora = await emailsDescadastrados(tx, empresaId, pegos.rows.map((p) => p.email));
    const idsDescadastrados = pegos.rows.filter((p) => fora.has(normalizarEmail(p.email))).map((p) => p.id);
    if (idsDescadastrados.length > 0) {
      await tx.update(enviosCampanha).set({ status: 'DESCADASTRADO' }).where(inArray(enviosCampanha.id, idsDescadastrados));
    }

    const paraEnviar = pegos.rows
      .filter((p) => !idsDescadastrados.includes(p.id))
      .map((p) => ({ id: p.id, campanhaId: p.campanha_id, nome: p.nome, email: p.email, assunto: porId.get(p.campanha_id)?.assunto ?? '', corpoHtml: porId.get(p.campanha_id)?.corpoHtml ?? '' }));
    return { paraEnviar, descadastrados: idsDescadastrados.length };
  });
}

/** AC-701: `ENVIADO`, com o horário do envio e uma tentativa a mais. */
export async function registrarEnviado(db: NodePgDatabase, empresaId: string, envioId: string, agora: Date): Promise<void> {
  await comTenant(db, { empresaId }, (tx) =>
    tx.update(enviosCampanha).set({ status: 'ENVIADO', enviadoEm: agora, tentativas: sql`${enviosCampanha.tentativas} + 1`, erro: null }).where(eq(enviosCampanha.id, envioId))
  );
}

/** AC-703: `ERRO` com o motivo e uma tentativa a mais. */
export async function registrarFalha(db: NodePgDatabase, empresaId: string, envioId: string, motivo: string): Promise<void> {
  await comTenant(db, { empresaId }, (tx) =>
    tx.update(enviosCampanha).set({ status: 'ERRO', tentativas: sql`${enviosCampanha.tentativas} + 1`, erro: motivo }).where(eq(enviosCampanha.id, envioId))
  );
}

/** AC-704: os pendentes das campanhas em andamento viram `ERRO` `SEM_CHAVE_RESEND`, sem mexer em `tentativas`. */
export async function marcarSemChave(db: NodePgDatabase, empresaId: string): Promise<number> {
  return comTenant(db, { empresaId }, async (tx) => {
    const r = await tx.execute(sql`
      UPDATE envios_campanha e SET status = 'ERRO', erro = 'SEM_CHAVE_RESEND'
      FROM campanhas c
      WHERE c.id = e.campanha_id AND c.status = 'PROCESSANDO' AND e.empresa_id = ${empresaId} AND e.status = 'PENDENTE'
    `);
    return r.rowCount ?? 0;
  });
}

/** AC-707: `ENVIANDO` há mais de 10 minutos vira `ERRO` `INTERROMPIDO` e NÃO é reenviado (pode já ter saído). */
export async function recuperarInterrompidos(db: NodePgDatabase, empresaId: string, agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - MINUTOS_PARA_CONSIDERAR_INTERROMPIDO * 60_000);
  return comTenant(db, { empresaId }, async (tx) => {
    const r = await tx
      .update(enviosCampanha)
      .set({ status: 'ERRO', erro: 'INTERROMPIDO' })
      .where(and(eq(enviosCampanha.empresaId, empresaId), eq(enviosCampanha.status, 'ENVIANDO'), lt(enviosCampanha.enviadoEm, limite)))
      .returning({ id: enviosCampanha.id });
    return r.length;
  });
}

/** AC-706: a campanha em andamento sem `PENDENTE` nem `ENVIANDO` vira `FINALIZADA`, sem depender da tela. */
export async function finalizarCampanhasConcluidas(db: NodePgDatabase, empresaId: string): Promise<number> {
  return comTenant(db, { empresaId }, async (tx) => {
    const r = await tx.execute(sql`
      UPDATE campanhas c SET status = 'FINALIZADA'
      WHERE c.empresa_id = ${empresaId} AND c.status = 'PROCESSANDO'
        AND NOT EXISTS (SELECT 1 FROM envios_campanha e WHERE e.campanha_id = c.id AND e.status IN ('PENDENTE', 'ENVIANDO'))
    `);
    return r.rowCount ?? 0;
  });
}

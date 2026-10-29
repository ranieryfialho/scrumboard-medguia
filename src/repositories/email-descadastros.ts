// T-271 (fase5-email-descadastro, US-174): a lista de descadastrados de cada empresa. Sempre por `comTenant` (o RLS
// isola as empresas, AC-717); o descadastro é idempotente e sempre com o e-mail em minúsculas.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { emailDescadastros, empresas } from '../db/schema';
import { normalizarEmail } from '../lib/email/descadastro-token';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant, type TransacaoTenant } from './contexto';

/** AC-715/AC-716: grava uma vez só, em qualquer grafia de maiúsculas e em qualquer número de chamadas. */
export async function descadastrar(db: NodePgDatabase, empresaId: string, email: string): Promise<void> {
  await comTenant(db, { empresaId }, (tx) =>
    tx.insert(emailDescadastros).values({ empresaId, email: normalizarEmail(email) }).onConflictDoNothing({ target: [emailDescadastros.empresaId, emailDescadastros.email] })
  );
}

/** AC-718/AC-722: dos e-mails dados, quais a empresa já descadastrou (em minúsculas). */
export async function emailsDescadastrados(tx: TransacaoTenant, empresaId: string, emails: string[]): Promise<Set<string>> {
  const minusculos = [...new Set(emails.map(normalizarEmail))];
  if (minusculos.length === 0) return new Set();
  const linhas = await tx
    .select({ email: emailDescadastros.email })
    .from(emailDescadastros)
    .where(and(eq(emailDescadastros.empresaId, empresaId), inArray(emailDescadastros.email, minusculos)));
  return new Set(linhas.map((l) => l.email));
}

export async function estaDescadastrado(db: NodePgDatabase, empresaId: string, email: string): Promise<boolean> {
  return comTenant(db, { empresaId }, async (tx) => (await emailsDescadastrados(tx, empresaId, [email])).size > 0);
}

/** AC-719: quantos e-mails a empresa da sessão descadastrou. */
export async function contarDescadastrados(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>): Promise<number> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx.select({ total: sql<number>`count(*)::int` }).from(emailDescadastros);
    return linha?.total ?? 0;
  });
}

/** O nome da empresa para a página pública; `null` se a empresa não existe. */
export async function nomeDaEmpresa(db: NodePgDatabase, empresaId: string): Promise<string | null> {
  const [e] = await db.select({ nome: empresas.nome }).from(empresas).where(eq(empresas.id, empresaId)).limit(1);
  return e?.nome ?? null;
}

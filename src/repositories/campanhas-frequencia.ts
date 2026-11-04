// T-308 (fase4-campanhas, US-130): "Proteção de frequência comercial" — quem recebeu algum e-mail de campanha nas últimas
// 72 horas fica de fora de uma campanha nova, para não cansar o contato (anti-fadiga). Vale para qualquer campanha da empresa.
import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';

import { enviosCampanha } from '../db/schema';
import type { TransacaoTenant } from './contexto';

export const HORAS_DE_PROTECAO = 72;

/** Dos e-mails dados (qualquer caixa), quais já receberam um e-mail de campanha nas últimas `HORAS_DE_PROTECAO` horas (em minúsculas). */
export async function emailsComEnvioRecente(tx: TransacaoTenant, empresaId: string, emails: string[], agora: Date = new Date()): Promise<Set<string>> {
  const minusculos = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  if (minusculos.length === 0) return new Set();
  const desde = new Date(agora.getTime() - HORAS_DE_PROTECAO * 3_600_000);
  const achados = new Set<string>();
  // Em blocos: uma lista enorme de parâmetros estoura o limite do Postgres.
  for (let i = 0; i < minusculos.length; i += 2000) {
    const linhas = await tx
      .select({ email: enviosCampanha.emailDestinatario })
      .from(enviosCampanha)
      .where(
        and(
          eq(enviosCampanha.empresaId, empresaId),
          isNotNull(enviosCampanha.enviadoEm),
          gte(enviosCampanha.enviadoEm, desde),
          inArray(enviosCampanha.status, ['ENVIADO', 'ABERTO', 'CLICADO']),
          inArray(sql<string>`lower(${enviosCampanha.emailDestinatario})`, minusculos.slice(i, i + 2000))
        )
      );
    for (const l of linhas) achados.add(l.email.trim().toLowerCase());
  }
  return achados;
}

// T-301 (fase4-tarefas-agenda, AC-765/AC-766): a conta Google que a empresa conectou, em `empresa_configuracoes` (chaves `google_refresh_token`,
// cifrada, e `google_conta_email`). Como a chave do Resend (src/repositories/email-config.ts): a tela só vê o e-mail da conta, nunca o token;
// só o servidor decifra, na hora de criar o evento da reunião.
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes } from '../db/schema';
import { cifrar, decifrar, ErroConfiguracaoIndisponivel, segredoDeConfiguracoes } from '../lib/seguranca/cifra';
import { comTenant } from './contexto';

const CHAVE_TOKEN = 'google_refresh_token';
const CHAVE_CONTA = 'google_conta_email';

export interface GoogleConectado {
  conectado: boolean;
  /** O e-mail da conta conectada (ex.: contato@medguia.com.br). */
  conta: string | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

async function ler(db: NodePgDatabase, empresaId: string) {
  const linhas = await comTenant(db, { empresaId }, (tx) =>
    tx
      .select({ chave: empresaConfiguracoes.chave, valor: empresaConfiguracoes.valor })
      .from(empresaConfiguracoes)
      .where(and(eq(empresaConfiguracoes.empresaId, empresaId), inArray(empresaConfiguracoes.chave, [CHAVE_TOKEN, CHAVE_CONTA])))
  );
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor])) as Record<string, unknown>;
}

/** O que a tela pode ver: se há conta conectada e qual. */
export async function lerGoogleConectado(db: NodePgDatabase, empresaId: string): Promise<GoogleConectado> {
  const v = await ler(db, empresaId);
  return { conectado: texto(v[CHAVE_TOKEN]) !== null, conta: texto(v[CHAVE_CONTA]) };
}

/** Guarda a conexão (o token vai cifrado). Sem o segredo do ambiente, `ErroConfiguracaoIndisponivel` e nada é gravado. */
export async function gravarGoogleConectado(
  db: NodePgDatabase,
  empresaId: string,
  conexao: { refreshToken: string; email: string },
  segredo: string | null = segredoDeConfiguracoes()
): Promise<void> {
  if (!segredo) throw new ErroConfiguracaoIndisponivel();
  await comTenant(db, { empresaId }, async (tx) => {
    for (const [chave, valor] of [
      [CHAVE_TOKEN, cifrar(conexao.refreshToken, segredo)],
      [CHAVE_CONTA, conexao.email],
    ] as const) {
      await tx
        .insert(empresaConfiguracoes)
        .values({ empresaId, chave, valor })
        .onConflictDoUpdate({ target: [empresaConfiguracoes.empresaId, empresaConfiguracoes.chave], set: { valor, atualizadoEm: new Date() } });
    }
  });
}

/** O refresh token já decifrado, para o servidor falar com o Google; `null` sem conexão, sem segredo ou com token que não decifra. */
export async function lerRefreshToken(db: NodePgDatabase, empresaId: string, segredo: string | null = segredoDeConfiguracoes()): Promise<string | null> {
  const v = await ler(db, empresaId);
  const cifrado = texto(v[CHAVE_TOKEN]);
  if (!cifrado || !segredo) return null;
  try {
    return decifrar(cifrado, segredo);
  } catch {
    return null;
  }
}

export async function removerGoogleConectado(db: NodePgDatabase, empresaId: string): Promise<void> {
  await comTenant(db, { empresaId }, (tx) =>
    tx.delete(empresaConfiguracoes).where(and(eq(empresaConfiguracoes.empresaId, empresaId), inArray(empresaConfiguracoes.chave, [CHAVE_TOKEN, CHAVE_CONTA])))
  );
}

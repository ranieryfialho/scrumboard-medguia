// T-259 (fase5-email-config, US-169): a chave do Resend e o remetente de cada empresa, em `empresa_configuracoes`
// (chaves `resend_api_key`, `resend_api_key_final` e `resend_remetente`, como no sistema legado). A chave é guardada
// CIFRADA (ASM-256); a API pública só devolve os 4 últimos caracteres; só o worker decifra (`lerConfiguracaoDeEmail`).
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { cifrar, decifrar, ErroConfiguracaoIndisponivel, segredoDeConfiguracoes } from '../lib/seguranca/cifra';
import { comTenant } from './contexto';

const CHAVE_API = 'resend_api_key';
const CHAVE_FINAL = 'resend_api_key_final';
const CHAVE_REMETENTE = 'resend_remetente';
const CHAVE_RESPONDER_PARA = 'resend_reply_to';
const CHAVES = [CHAVE_API, CHAVE_FINAL, CHAVE_REMETENTE, CHAVE_RESPONDER_PARA];

export interface ConfiguracaoDeEmailPublica {
  chaveConfigurada: boolean;
  chaveFinal: string | null;
  remetente: string | null;
  /** T-307: o e-mail para onde vão as respostas dos destinatários (cabeçalho Reply-To); só vem quando configurado. */
  responderPara?: string;
}

async function lerValores(tx: Parameters<Parameters<typeof comTenant>[2]>[0], empresaId: string): Promise<Record<string, unknown>> {
  const linhas = await tx
    .select({ chave: empresaConfiguracoes.chave, valor: empresaConfiguracoes.valor })
    .from(empresaConfiguracoes)
    .where(and(eq(empresaConfiguracoes.empresaId, empresaId), inArray(empresaConfiguracoes.chave, CHAVES)));
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

// Os 4 últimos caracteres vão com prefixo: o Drizzle faz `JSON.parse` do jsonb e "1111" voltaria como o número 1111 ("0123" perderia o zero).
const PREFIXO_FINAL = 'f:';

/** AC-695: o que a tela pode ver — nunca a chave. */
export async function lerConfiguracaoDeEmailPublica(db: NodePgDatabase, contexto: Pick<ContextoTenant, 'empresaId'>): Promise<ConfiguracaoDeEmailPublica> {
  const v = await comTenant(db, contexto, (tx) => lerValores(tx, contexto.empresaId));
  return { chaveConfigurada: texto(v[CHAVE_API]) !== null, chaveFinal: texto(v[CHAVE_FINAL])?.startsWith(PREFIXO_FINAL) ? (texto(v[CHAVE_FINAL]) as string).slice(PREFIXO_FINAL.length) : null, remetente: texto(v[CHAVE_REMETENTE]), ...(texto(v[CHAVE_RESPONDER_PARA]) ? { responderPara: texto(v[CHAVE_RESPONDER_PARA]) as string } : {}) };
}

/**
 * AC-695/AC-696/AC-697: `chave` ausente mantém a atual, `null` remove, texto grava cifrada (sem o segredo do ambiente,
 * `ErroConfiguracaoIndisponivel` e nada é gravado); `remetente` ausente mantém, `null` remove.
 */
export async function gravarConfiguracaoDeEmail(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>,
  alteracao: { chave?: string | null; remetente?: string | null; responderPara?: string | null },
  segredo: string | null = segredoDeConfiguracoes()
): Promise<void> {
  if (typeof alteracao.chave === 'string' && !segredo) throw new ErroConfiguracaoIndisponivel();

  await comTenant(db, contexto, async (tx) => {
    const gravar = async (chave: string, valor: string | null) => {
      if (valor === null) {
        await tx.delete(empresaConfiguracoes).where(and(eq(empresaConfiguracoes.empresaId, contexto.empresaId), eq(empresaConfiguracoes.chave, chave)));
        return;
      }
      await tx
        .insert(empresaConfiguracoes)
        .values({ empresaId: contexto.empresaId, chave, valor })
        .onConflictDoUpdate({ target: [empresaConfiguracoes.empresaId, empresaConfiguracoes.chave], set: { valor, atualizadoEm: new Date() } });
    };
    if (alteracao.chave === null) {
      await gravar(CHAVE_API, null);
      await gravar(CHAVE_FINAL, null);
    } else if (typeof alteracao.chave === 'string') {
      await gravar(CHAVE_API, cifrar(alteracao.chave, segredo as string));
      await gravar(CHAVE_FINAL, `${PREFIXO_FINAL}${alteracao.chave.slice(-4)}`);
    }
    if (alteracao.remetente !== undefined) await gravar(CHAVE_REMETENTE, alteracao.remetente);
    if (alteracao.responderPara !== undefined) await gravar(CHAVE_RESPONDER_PARA, alteracao.responderPara);
  });
}

/** AC-696: o que o worker usa — a chave já decifrada. `null` sem chave, sem segredo ou com chave que não decifra. */
export async function lerConfiguracaoDeEmail(
  db: NodePgDatabase,
  empresaId: string,
  segredo: string | null = segredoDeConfiguracoes()
): Promise<{ apiKey: string; remetente: string | null; replyTo?: string } | null> {
  const v = await comTenant(db, { empresaId }, (tx) => lerValores(tx, empresaId));
  const cifrado = texto(v[CHAVE_API]);
  if (!cifrado || !segredo) return null;
  try {
    return { apiKey: decifrar(cifrado, segredo), remetente: texto(v[CHAVE_REMETENTE]), ...(texto(v[CHAVE_RESPONDER_PARA]) ? { replyTo: texto(v[CHAVE_RESPONDER_PARA]) as string } : {}) };
  } catch {
    return null;
  }
}

// T-077 (fase2c-whatsapp-conversa, AC-144): nome da instância Evolution da
// empresa, lido do Postgres novo (`empresa_configuracoes`, chave
// `evolution_instance_name` — ASM-040), sempre por `comTenant`. `null`
// quando a empresa não cadastrou a chave: quem chama decide o que fazer
// (AC-144 é recusar o envio com 409 `WHATSAPP_NAO_CONFIGURADO`).
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

const CHAVE_INSTANCIA = 'evolution_instance_name';

/**
 * Nome da instância Evolution configurada pela empresa do `contexto`, ou
 * `null` quando a chave `evolution_instance_name` não foi cadastrada.
 */
export async function buscarNomeInstancia(
  db: NodePgDatabase,
  contexto: Pick<ContextoTenant, 'empresaId'>
): Promise<string | null> {
  return comTenant(db, contexto, async (tx) => {
    const registros = await tx
      .select({ valor: empresaConfiguracoes.valor })
      .from(empresaConfiguracoes)
      .where(
        and(eq(empresaConfiguracoes.empresaId, contexto.empresaId), eq(empresaConfiguracoes.chave, CHAVE_INSTANCIA))
      )
      .limit(1);

    const valor = registros[0]?.valor;
    return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
  });
}

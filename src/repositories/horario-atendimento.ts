// fase6-atendimento-lead (US-182): o horário de atendimento (expediente por dia da semana) de cada empresa. Fica em
// `empresa_configuracoes` (chave `horario_atendimento`, valor JSON com os sete dias); sem registro, vale o padrão de segunda a
// sexta, 09:00 às 18:00 (ASM-303). O isolamento por empresa é o RLS dessa tabela, sempre sob `comTenant`.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresaConfiguracoes } from '../db/schema';
import { HORARIO_PADRAO, validarHorario, type HorarioComercial } from '../domain/atendimento/horario-comercial';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant, type TransacaoTenant } from './contexto';

export const CHAVE_HORARIO_ATENDIMENTO = 'horario_atendimento';

export interface HorarioDaEmpresa {
  horario: HorarioComercial;
  /** `true` quando a empresa ainda não gravou um horário e vale o padrão. */
  padrao: boolean;
}

/** Lê o horário dentro de uma transação já aberta no tenant (usado pelo relatório de marketing). Valor gravado inválido volta ao padrão. */
export async function lerHorarioNaTransacao(
  tx: TransacaoTenant,
  empresaId: string
): Promise<HorarioDaEmpresa> {
  const [linha] = await tx
    .select({ valor: empresaConfiguracoes.valor })
    .from(empresaConfiguracoes)
    .where(and(eq(empresaConfiguracoes.empresaId, empresaId), eq(empresaConfiguracoes.chave, CHAVE_HORARIO_ATENDIMENTO)))
    .limit(1);
  if (!linha) return { horario: HORARIO_PADRAO, padrao: true };
  const validado = validarHorario(linha.valor);
  return validado.ok ? { horario: validado.horario, padrao: false } : { horario: HORARIO_PADRAO, padrao: true };
}

export async function lerHorarioAtendimento(db: NodePgDatabase, contexto: ContextoTenant): Promise<HorarioDaEmpresa> {
  return comTenant(db, contexto, (tx) => lerHorarioNaTransacao(tx, contexto.empresaId));
}

/** Grava (ou troca) o horário da empresa da sessão; quem chama já validou com `validarHorario`. */
export async function gravarHorarioAtendimento(db: NodePgDatabase, contexto: ContextoTenant, horario: HorarioComercial): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    await tx
      .insert(empresaConfiguracoes)
      .values({ empresaId: contexto.empresaId, chave: CHAVE_HORARIO_ATENDIMENTO, valor: horario })
      .onConflictDoUpdate({ target: [empresaConfiguracoes.empresaId, empresaConfiguracoes.chave], set: { valor: horario, atualizadoEm: new Date() } });
  });
}

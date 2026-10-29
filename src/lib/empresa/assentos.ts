// T-237 (fase5-empresa-dados, US-154): a cota de assentos da empresa. Assentos em uso = vínculos
// `empresas_usuarios` ativos (convite pendente reserva o assento, ASM-229); `assentos` vazio = sem limite.
// A checagem roda DENTRO da transação de quem cria ou reativa o vínculo, com a linha da empresa
// travada (`FOR UPDATE`), para dois convites simultâneos não furarem a cota (AC-655/AC-656).
import { sql } from 'drizzle-orm';

import type { TransacaoTenant } from '../../repositories/contexto';

export class ErroSemAssentos extends Error {
  constructor() {
    super('A empresa atingiu o limite de assentos do plano.');
    this.name = 'ErroSemAssentos';
  }
}

export async function garantirAssento(tx: TransacaoTenant, empresaId: string): Promise<void> {
  const r = await tx.execute<{ assentos: number | null; em_uso: number }>(sql`
    SELECT e.assentos, (SELECT count(*)::int FROM empresas_usuarios eu WHERE eu.empresa_id = e.id AND eu.ativo) AS em_uso
    FROM empresas e WHERE e.id = ${empresaId} FOR UPDATE
  `);
  const linha = r.rows[0];
  if (linha && linha.assentos !== null && linha.em_uso >= linha.assentos) throw new ErroSemAssentos();
}

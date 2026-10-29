// T-224 (fase5-investimento-midia, US-147): leitura e gravação do investimento em mídia da empresa
// da sessão. Sempre por `comTenant` — o RLS de `investimento_midia` garante o isolamento (AC-632).
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { chaveDoCanal, type LinhaDeInvestimento } from '../lib/investimento/calculo';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant, type TransacaoTenant } from './contexto';

export interface CanalDoMes {
  canal: string;
  /** `null` = "Sem investimento". */
  valor: number | null;
}
export interface InvestimentoDoMes {
  mes: string;
  canais: CanalDoMes[];
  total: number;
}

/** AC-627: as origens dos leads mais os canais já cadastrados no mês, com o valor de cada um. */
export async function lerInvestimentoDoMes(db: NodePgDatabase, contexto: ContextoTenant, mes: string): Promise<InvestimentoDoMes> {
  return comTenant(db, contexto, async (tx) => {
    const cadastrados = await tx.execute<{ canal: string; valor: string }>(sql`
      SELECT canal, valor::text AS valor FROM investimento_midia WHERE mes = ${`${mes}-01`}::date
    `);
    const origens = await tx.execute<{ origem: string }>(sql`
      SELECT DISTINCT btrim(origem) AS origem FROM leads WHERE nullif(btrim(origem), '') IS NOT NULL LIMIT 200
    `);
    const mapa = new Map<string, CanalDoMes>();
    for (const o of origens.rows) mapa.set(chaveDoCanal(o.origem), { canal: o.origem, valor: null });
    for (const c of cadastrados.rows) mapa.set(chaveDoCanal(c.canal), { canal: c.canal, valor: Number(c.valor) });
    const canais = [...mapa.values()].sort((a, b) => a.canal.localeCompare(b.canal, 'pt-BR'));
    return { mes, canais, total: Math.round(canais.reduce((s, c) => s + (c.valor ?? 0), 0) * 100) / 100 };
  });
}

/** `null` remove (AC-630); número grava ou troca (AC-628); canal repetido por grafia usa o existente (AC-631). */
export async function gravarInvestimento(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  mes: string,
  valores: Array<{ canal: string; valor: number | null }>
): Promise<void> {
  await comTenant(db, contexto, async (tx) => {
    for (const { canal, valor } of valores) {
      const existente = await tx.execute<{ canal: string }>(sql`
        SELECT canal FROM investimento_midia WHERE mes = ${`${mes}-01`}::date AND lower(canal) = ${chaveDoCanal(canal)}
      `);
      if (valor === null) {
        await tx.execute(sql`DELETE FROM investimento_midia WHERE mes = ${`${mes}-01`}::date AND lower(canal) = ${chaveDoCanal(canal)}`);
        continue;
      }
      if (existente.rows[0]) {
        await tx.execute(sql`
          UPDATE investimento_midia SET valor = ${valor.toFixed(2)}::numeric, atualizado_por = ${contexto.usuarioId}, atualizado_em = now()
          WHERE mes = ${`${mes}-01`}::date AND lower(canal) = ${chaveDoCanal(canal)}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO investimento_midia (empresa_id, mes, canal, valor, atualizado_por)
          VALUES (${contexto.empresaId}, ${`${mes}-01`}::date, ${canal}, ${valor.toFixed(2)}::numeric, ${contexto.usuarioId})
        `);
      }
    }
  });
}

/** Linhas dos meses que tocam `de`..`ate` (datas locais), para o relatório de marketing. */
export async function lerInvestimentoNoPeriodo(tx: TransacaoTenant, de: string, ate: string): Promise<LinhaDeInvestimento[]> {
  const r = await tx.execute<{ mes: string; canal: string; valor: string }>(sql`
    SELECT to_char(mes, 'YYYY-MM-DD') AS mes, canal, valor::text AS valor FROM investimento_midia
    WHERE mes >= date_trunc('month', ${de}::date)::date AND mes <= ${ate}::date
  `);
  return r.rows.map((l) => ({ mes: l.mes, canal: l.canal, valor: Number(l.valor) }));
}

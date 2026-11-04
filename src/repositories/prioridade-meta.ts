// Regra de ordenação do funil e da lista: os leads NOVOS vindos do Meta (Instagram/Facebook)
// ficam nas primeiras posições de cada coluna, do mais recente para o mais antigo, e o resto
// segue a ordem de sempre. "Novo" = não veio do ETL do sistema legado (`migracao_registros`);
// assim os cards importados ficam abaixo, prontos para o saneamento. Origem do Meta = texto
// da origem do lead com meta, facebook ou instagram (ex.: "Meta Ads (Instagram / FB)").
import { sql } from 'drizzle-orm';

import { leads, oportunidades } from '../db/schema';

/** 0 = lead novo do Meta; 1 = todos os demais. */
export const prioridadeMeta = sql<number>`case when ${leads.origem} ~* '(meta|facebook|instagram|^bm )' and not exists (select 1 from migracao_registros m where m.id_destino = ${leads.id}) then 0 else 1 end`;

/** Ordenação padrão do funil: Meta novos primeiro (recentes antes), depois os outros do mais antigo ao mais novo. */
export const ordemPadraoComMetaPrimeiro = [
  prioridadeMeta,
  sql`case when ${prioridadeMeta} = 0 then ${oportunidades.criadoEm} end desc`,
  sql`${oportunidades.criadoEm} asc`,
  sql`${oportunidades.id} asc`,
] as const;

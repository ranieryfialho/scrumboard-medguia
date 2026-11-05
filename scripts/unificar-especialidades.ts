// Unifica a especialidade dos leads (`leads.dados.especialidade`) no nome padrão de `src/domain/leads/especialidades.ts`.
// - Reconhecida: vira o nome padrão (ex.: "Fisioterapeuta" -> "Fisioterapia").
// - Não reconhecida (nome de pessoa, telefone, "Boa tarde", "Pedreiro"...): sai de `especialidade` e aparece como "sem especialidade".
// Em todos os casos o texto digitado fica guardado em `dados.especialidade_original` (reversível) e o resto de `dados` não muda.
// Uso (na VPS, em container node, com o DATABASE_URL do crm_migrator):
//   npx tsx scripts/unificar-especialidades.ts            -> só mostra o que faria (nada é gravado)
//   npx tsx scripts/unificar-especialidades.ts --aplicar  -> grava, numa transação
import { Pool } from 'pg';

import { normalizarEspecialidade } from '../src/domain/leads/especialidades';

const aplicar = process.argv.includes('--aplicar');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const cliente = await pool.connect();
  try {
    const { rows } = await cliente.query<{ id: string; dados: Record<string, unknown> }>(
      `SELECT id, dados FROM leads WHERE nullif(btrim(dados ->> 'especialidade'), '') IS NOT NULL ORDER BY id`
    );

    const porPadrao = new Map<string, number>();
    const descartados = new Map<string, number>();
    const mudancas: { id: string; dados: Record<string, unknown> }[] = [];
    let jaPadrao = 0;

    for (const { id, dados } of rows) {
      const original = String(dados.especialidade).trim();
      const padrao = normalizarEspecialidade(original);
      if (padrao === original && dados.especialidade === original) {
        jaPadrao += 1;
        porPadrao.set(padrao, (porPadrao.get(padrao) ?? 0) + 1);
        continue;
      }
      const { especialidade: _antiga, ...resto } = dados;
      void _antiga;
      const novo: Record<string, unknown> = { ...resto, especialidade_original: dados.especialidade_original ?? original };
      if (padrao) {
        novo.especialidade = padrao;
        porPadrao.set(padrao, (porPadrao.get(padrao) ?? 0) + 1);
      } else {
        descartados.set(original, (descartados.get(original) ?? 0) + 1);
      }
      mudancas.push({ id, dados: novo });
    }

    console.log(`Leads com especialidade: ${rows.length} | já no padrão: ${jaPadrao} | a alterar: ${mudancas.length}`);
    console.log('\nPor especialidade padrão (depois da unificação):');
    for (const [nome, qtd] of [...porPadrao.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`  ${String(qtd).padStart(4)}  ${nome}`);
    console.log(`\nNão reconhecidos (saem de "especialidade", ficam em "especialidade_original"): ${[...descartados.values()].reduce((a, b) => a + b, 0)}`);
    for (const [texto, qtd] of [...descartados.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${String(qtd).padStart(4)}  ${JSON.stringify(texto).slice(0, 90)}`);

    if (!aplicar) {
      console.log('\nSIMULAÇÃO: nada foi gravado. Rode de novo com --aplicar para gravar.');
      return;
    }
    await cliente.query('BEGIN');
    try {
      for (const m of mudancas) await cliente.query(`UPDATE leads SET dados = $1::jsonb WHERE id = $2`, [JSON.stringify(m.dados), m.id]);
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    }
    console.log(`\nGRAVADO: ${mudancas.length} leads atualizados.`);
  } finally {
    cliente.release();
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('FALHOU:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});

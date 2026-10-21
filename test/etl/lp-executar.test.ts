// Testes de T-123 (fase3-etl-lp, US-085): orquestrador do ETL da LP
// (src/etl/lp/executar.ts). Contra Postgres real (mesmo harness de
// T-108/T-120/T-122) porque AC-302 (idempotência em reexecução), AC-303
// (rollback da simulação) e AC-305 (rollback de uma falha no meio) só se
// provam com transação e constraints de verdade — um mock não prova
// rollback.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoExecucao } from '../../src/etl/comum';
import {
  ErroContagemDivergenteDaOrigem,
  ErroRelatorioInconsistente,
  executarMigracaoLp,
} from '../../src/etl/lp/executar';
import type { CadastroLpBruto } from '../../src/etl/lp/origem';
import { empresas, leads, migracaoRegistros, oportunidadeEventos, oportunidades } from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

function cadastroLp(parcial: Partial<CadastroLpBruto> & { id: number | string }): CadastroLpBruto {
  return {
    name: 'Cadastro ' + parcial.id,
    email: null,
    whatsapp: null,
    especialidade: null,
    crm: null,
    anuncio: null,
    status: null,
    observacoes: null,
    created_at: null,
    data_alteracao: null,
    data_fechamento: null,
    termos_aceitos: null,
    progresso_video: null,
    ...parcial,
  };
}

describe('T-123: orquestrador do ETL da LP contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaMedguia = { id: '40000000-0000-0000-0000-000000000001', nome: 'MedGuia', slug: 'medguia-t123' };

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
    await db.execute('DELETE FROM migracao_registros');
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.delete(empresas);
    await db.insert(empresas).values([empresaMedguia]);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  beforeEach(async () => {
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(leads);
    await db.execute("DELETE FROM migracao_registros");
  });

  test(
    'rodar o ETL de novo sobre os mesmos cadastros não duplica nada (@spec:AC-302)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'lp-302', simulacao: false };
      const cadastros = [
        cadastroLp({ id: 201, name: 'Dr. João', email: 'joao@exemplo.com', status: 'Novos Leads' }),
        cadastroLp({ id: 202, name: 'Dra. Ana', email: 'ana@exemplo.com', status: 'Fechado' }),
      ];

      const primeira = await executarMigracaoLp(db, contexto, empresaMedguia.id, cadastros, cadastros.length);
      expect(primeira).toMatchObject({ lidas: 2, criadas: 2, ignoradas: 0, emRevisao: 0 });

      const segunda = await executarMigracaoLp(db, contexto, empresaMedguia.id, cadastros, cadastros.length);
      expect(segunda).toMatchObject({ lidas: 2, criadas: 0, ignoradas: 2, emRevisao: 0 });

      const totalLeads = await db.select().from(leads);
      const totalOportunidades = await db.select().from(oportunidades);
      const totalEventos = await db.select().from(oportunidadeEventos);
      expect(totalLeads).toHaveLength(2);
      expect(totalOportunidades).toHaveLength(2);
      expect(totalEventos).toHaveLength(2);
    }
  );

  test(
    'em modo simulação, o banco de destino continua idêntico e o relatório diz o que seria criado, ignorado e em revisão (@spec:AC-303)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'lp-303', simulacao: true };
      const cadastros = [
        cadastroLp({ id: 301, name: 'Dr. Carlos', email: 'carlos@exemplo.com', status: 'Novos Leads' }),
        cadastroLp({ id: 302, name: 'Dr. Status Desconhecido', status: 'Status Nunca Visto' }),
      ];

      const relatorio = await executarMigracaoLp(db, contexto, empresaMedguia.id, cadastros, cadastros.length);

      expect(relatorio.simulacao).toBe(true);
      expect(relatorio).toMatchObject({ lidas: 2, criadas: 1, ignoradas: 0, emRevisao: 1 });
      expect(relatorio.revisao).toHaveLength(1);
      expect(relatorio.revisao[0]).toMatchObject({ idLp: '302', tipo: 'status_em_revisao' });

      const totalLeads = await db.select().from(leads);
      const totalOportunidades = await db.select().from(oportunidades);
      const totalEventos = await db.select().from(oportunidadeEventos);
      const totalRegistrosMigracao = await db.select().from(migracaoRegistros);
      expect(totalLeads).toHaveLength(0);
      expect(totalOportunidades).toHaveLength(0);
      expect(totalEventos).toHaveLength(0);
      expect(totalRegistrosMigracao).toHaveLength(0);
    }
  );

  test(
    'o relatório confere lidas = criadas + ignoradas + em revisão, e lidas com o total de linhas da LP (@spec:AC-304)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'lp-304', simulacao: false };
      const cadastros = [
        cadastroLp({ id: 401, name: 'Dr. Pedro', email: 'pedro@exemplo.com', status: 'Novos Leads' }),
        cadastroLp({ id: 402, name: 'Dr. Reunião', email: 'reuniao@exemplo.com', status: 'Reunião Agendada' }),
        cadastroLp({ id: 403, name: 'Dr. Desconhecido', status: 'Status Nunca Visto' }),
      ];

      const relatorio = await executarMigracaoLp(db, contexto, empresaMedguia.id, cadastros, cadastros.length);

      expect(relatorio.lidas).toBe(relatorio.criadas + relatorio.ignoradas + relatorio.emRevisao);
      expect(relatorio.lidas).toBe(cadastros.length);

      await expect(
        executarMigracaoLp(
          db,
          { origem: 'lp-304-divergente', simulacao: false },
          empresaMedguia.id,
          cadastros,
          cadastros.length + 1
        )
      ).rejects.toThrow(ErroContagemDivergenteDaOrigem);
    }
  );

  test(
    'uma falha no meio da importação derruba a transação inteira — nada da execução fica gravado (@spec:AC-305)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'lp-305', simulacao: false };
      const cadastros = [
        cadastroLp({ id: 501, name: 'Dr. Primeiro', email: 'primeiro@exemplo.com', status: 'Novos Leads' }),
        cadastroLp({ id: 502, name: 'Dr. Segundo', email: 'segundo@exemplo.com', status: null }),
      ];
      // A decisão do segundo cadastro aponta para uma etapa que não existe
      // no destino: viola a FK de `oportunidades.etapa_id` depois que o
      // primeiro cadastro já tinha sido gravado *dentro desta mesma
      // transação* — o rollback precisa derrubar os dois.
      const decisoes = { '502': { etapaId: 999999 } };

      await expect(
        executarMigracaoLp(db, contexto, empresaMedguia.id, cadastros, cadastros.length, decisoes)
      ).rejects.toThrow();

      const totalLeads = await db.select().from(leads);
      const totalOportunidades = await db.select().from(oportunidades);
      const totalRegistrosMigracao = await db.select().from(migracaoRegistros);
      expect(totalLeads).toHaveLength(0);
      expect(totalOportunidades).toHaveLength(0);
      expect(totalRegistrosMigracao).toHaveLength(0);
    }
  );

  test(
    'password_hash nunca aparece no relatório, mesmo quando o objeto de origem carrega o campo (@spec:AC-299)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'lp-299', simulacao: false };
      const segredoDaLp = 'hash-secreto-que-nunca-pode-vazar';
      const cadastroComHashExtra = {
        ...cadastroLp({ id: 601, name: 'Dr. Senha', email: 'senha@exemplo.com', status: 'Novos Leads' }),
        // `CadastroLpBruto` não declara esta coluna (T-121 nunca a seleciona
        // da LP) — simula um objeto que a carregasse mesmo assim, para
        // provar que o orquestrador não a propaga ao relatório.
        password_hash: segredoDaLp,
      } as CadastroLpBruto;

      const relatorio = await executarMigracaoLp(
        db,
        contexto,
        empresaMedguia.id,
        [cadastroComHashExtra],
        1
      );

      expect(JSON.stringify(relatorio)).not.toContain(segredoDaLp);

      const [leadCriado] = await db.select().from(leads);
      expect(JSON.stringify(leadCriado)).not.toContain(segredoDaLp);
    }
  );

  test('ErroRelatorioInconsistente existe e carrega a mensagem com as contagens', () => {
    const erro = new ErroRelatorioInconsistente({ lidas: 5, criadas: 1, ignoradas: 1, emRevisao: 1 });
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toContain('lidas=5');
  });

  test('ErroContagemDivergenteDaOrigem existe e carrega a mensagem com os dois totais', () => {
    const erro = new ErroContagemDivergenteDaOrigem(3, 4);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toContain('3');
    expect(erro.message).toContain('4');
  });
});

// Testes de T-113 (fase3-etl-supabase, US-074): orquestrador do ETL
// (src/etl/supabase/executar.ts). Contra Postgres real (mesmo harness de
// T-108 a T-112) porque AC-267/AC-268/AC-270 só se provam com transação e
// constraints de verdade — mock não prova rollback.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoExecucao } from '../../src/etl/comum';
import {
  ErroRelatorioInconsistente,
  executarMigracaoSupabase,
  type DadosOrigemEtl,
} from '../../src/etl/supabase/executar';
import type { CampanhaLegado, EnvioLegado } from '../../src/etl/supabase/campanhas';
import type { EmpresaLegado, UsuarioLegado } from '../../src/etl/supabase/identidade';
import type { LeadLegado } from '../../src/etl/supabase/leads';
import type { ConfiguracaoLegado, MensagemLegado } from '../../src/etl/supabase/mensagens-config';
import {
  campanhas,
  empresaConfiguracoes,
  empresas,
  empresasUsuarios,
  enviosCampanha,
  leads,
  migracaoRegistros,
  motivosPerda,
  oportunidadeEventos,
  oportunidades,
  usuarios,
  whatsappMensagens,
} from '../../src/db/schema';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

describe('T-113: orquestrador do ETL contra Postgres real', () => {
  let pg: PostgresEfemero;
  let db: NodePgDatabase;
  let pool: Pool;

  const empresaA: EmpresaLegado = {
    id: '10000000-0000-0000-0000-000000000001',
    nome: 'Clínica A',
    slug: 'clinica-a',
  };

  function dadosValidos(): DadosOrigemEtl {
    const usuario: UsuarioLegado = {
      id: '20000000-0000-0000-0000-000000000001',
      email: 'gerente@clinica-a.com',
      nome: 'Gerente A',
      perfil: 'ADMIN',
      ativo: true,
      empresaId: empresaA.id,
      isSuperAdmin: false,
    };
    const lead: LeadLegado = {
      id: '30000000-0000-0000-0000-000000000001',
      empresaId: empresaA.id,
      nome: 'Lead 1',
      email: 'lead1@example.com',
      situacao: 'Novos Leads',
      origem: 'site',
      observacoes: null,
      whatsapp: null,
    };
    const campanha: CampanhaLegado = {
      id: '40000000-0000-0000-0000-000000000001',
      empresaId: empresaA.id,
      nome: 'Campanha 1',
      assunto: 'Assunto',
      corpoHtml: '<p>oi</p>',
      status: 'FINALIZADA',
      criadoPor: null,
    };
    const envio: EnvioLegado = {
      id: '50000000-0000-0000-0000-000000000001',
      empresaId: empresaA.id,
      campanhaId: campanha.id,
      nomeDestinatario: 'Lead 1',
      emailDestinatario: 'lead1@example.com',
      status: 'ENVIADO',
      tentativas: 1,
    };
    const mensagem: MensagemLegado = {
      id: '60000000-0000-0000-0000-000000000001',
      empresaId: empresaA.id,
      leadId: lead.id,
      numero: '5511999990000',
      mensagem: 'Olá',
      direcao: 'recebida',
      status: 'entregue',
      evolutionMessageId: null,
      lidaEm: null,
      criadoEm: new Date('2026-01-10T12:00:00Z'),
    };
    const configuracao: ConfiguracaoLegado = {
      id: '70000000-0000-0000-0000-000000000001',
      empresaId: empresaA.id,
      chave: 'evolution_instance_name',
      valor: 'instancia-legado',
    };

    return {
      empresas: [empresaA],
      usuarios: [usuario],
      leads: [lead],
      campanhas: [campanha],
      envios: [envio],
      mensagens: [mensagem],
      configuracoes: [configuracao],
    };
  }

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.migratorUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  async function limparTudo() {
    await db.execute('DELETE FROM migracao_registros');
    await db.delete(whatsappMensagens);
    await db.delete(empresaConfiguracoes);
    await db.delete(enviosCampanha);
    await db.delete(campanhas);
    await db.delete(oportunidadeEventos);
    await db.delete(oportunidades);
    await db.delete(motivosPerda);
    await db.delete(leads);
    await db.delete(empresasUsuarios);
    await db.delete(usuarios);
    await db.delete(empresas);
  }

  beforeEach(async () => {
    await limparTudo();
  });

  test(
    'o relatório mostra lidas/criadas/ignoradas/em revisão por entidade e a conta fecha (@spec:AC-269)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-legado-269', simulacao: false };
      const relatorio = await executarMigracaoSupabase(db, contexto, dadosValidos());

      expect(relatorio.simulacao).toBe(false);
      const entidades = relatorio.linhas.map((l) => l.entidade);
      expect(entidades).toEqual([
        'empresa',
        'usuario',
        'lead',
        'campanha',
        'envio_campanha',
        'mensagem_whatsapp',
        'configuracao_empresa',
      ]);

      for (const linha of relatorio.linhas) {
        expect(linha.lidas).toBe(linha.criadas + linha.ignoradas + linha.emRevisao);
        expect(linha.lidas).toBeGreaterThan(0);
      }

      const empresaLinha = relatorio.linhas.find((l) => l.entidade === 'empresa');
      expect(empresaLinha).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0, emRevisao: 0 });
    }
  );

  test(
    'rodar o ETL completo de novo sobre os mesmos dados não cria nem duplica nada (@spec:AC-267)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-legado-267', simulacao: false };
      const dados = dadosValidos();

      const primeira = await executarMigracaoSupabase(db, contexto, dados);
      for (const linha of primeira.linhas) {
        expect(linha.criadas).toBeGreaterThan(0);
      }

      const segunda = await executarMigracaoSupabase(db, contexto, dados);
      for (const linha of segunda.linhas) {
        expect(linha.criadas).toBe(0);
        expect(linha.ignoradas).toBe(linha.lidas - linha.emRevisao);
      }

      const totalEmpresas = await db.select().from(empresas);
      const totalLeads = await db.select().from(leads);
      const totalMensagens = await db.select().from(whatsappMensagens);
      expect(totalEmpresas).toHaveLength(1);
      expect(totalLeads).toHaveLength(1);
      expect(totalMensagens).toHaveLength(1);
    }
  );

  test(
    'em modo simulação, o destino continua idêntico e o relatório indica o que seria feito (@spec:AC-268)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-legado-268', simulacao: true };

      const relatorio = await executarMigracaoSupabase(db, contexto, dadosValidos());

      expect(relatorio.simulacao).toBe(true);
      const empresaLinha = relatorio.linhas.find((l) => l.entidade === 'empresa');
      expect(empresaLinha).toMatchObject({ lidas: 1, criadas: 1, ignoradas: 0 });

      const totalEmpresas = await db.select().from(empresas);
      const totalUsuarios = await db.select().from(usuarios);
      const totalLeads = await db.select().from(leads);
      const totalMensagens = await db.select().from(whatsappMensagens);
      const totalConfiguracoes = await db.select().from(empresaConfiguracoes);
      const totalRegistrosMigracao = await db.select().from(migracaoRegistros);

      expect(totalEmpresas).toHaveLength(0);
      expect(totalUsuarios).toHaveLength(0);
      expect(totalLeads).toHaveLength(0);
      expect(totalMensagens).toHaveLength(0);
      expect(totalConfiguracoes).toHaveLength(0);
      expect(totalRegistrosMigracao).toHaveLength(0);
    }
  );

  test(
    'uma etapa que falha no meio derruba a transação inteira — nada da execução fica gravado (@spec:AC-270)',
    async () => {
      const contexto: ContextoExecucao = { origem: 'supabase-legado-270', simulacao: false };
      const dados = dadosValidos();
      // Lead referenciando uma empresa que não existe no destino (nem veio em
      // `dados.empresas`) viola a FK de `leads.empresa_id` — a etapa de leads
      // falha depois que empresas/usuários já tinham sido gravados *dentro
      // desta mesma transação*, então o rollback precisa derrubar os dois.
      dados.leads = [
        { ...dados.leads[0], empresaId: '99999999-9999-9999-9999-999999999999' },
      ];

      await expect(executarMigracaoSupabase(db, contexto, dados)).rejects.toThrow();

      const totalEmpresas = await db.select().from(empresas);
      const totalUsuarios = await db.select().from(usuarios);
      const totalRegistrosMigracao = await db.select().from(migracaoRegistros);
      expect(totalEmpresas).toHaveLength(0);
      expect(totalUsuarios).toHaveLength(0);
      expect(totalRegistrosMigracao).toHaveLength(0);
    }
  );

  test('ErroRelatorioInconsistente existe e carrega a linha que não fechou a conta', () => {
    const erro = new ErroRelatorioInconsistente({
      entidade: 'teste',
      lidas: 3,
      criadas: 1,
      ignoradas: 1,
      emRevisao: 0,
    });
    expect(erro.message).toContain('teste');
    expect(erro.message).toContain('lidas=3');
  });

  test('lead que entra na fila de revisão aparece em `emRevisao` e em `revisao`, sem quebrar a conta', async () => {
    const contexto: ContextoExecucao = { origem: 'supabase-legado-revisao', simulacao: false };
    const dados = dadosValidos();
    dados.leads = [
      { ...dados.leads[0], situacao: 'Em contato' },
    ];
    dados.mensagens = [];

    const relatorio = await executarMigracaoSupabase(db, contexto, dados);

    const leadLinha = relatorio.linhas.find((l) => l.entidade === 'lead');
    expect(leadLinha).toMatchObject({ lidas: 1, criadas: 0, ignoradas: 0, emRevisao: 1 });
    expect(relatorio.revisao).toHaveLength(1);
    expect(relatorio.revisao[0]).toMatchObject({ idExterno: dados.leads[0].id, tipo: 'situacao_sem_etapa' });
  });
});

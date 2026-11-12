// fase6-atendimento-lead (US-181): a velocidade do 1º contato do relatório de marketing, contra um Postgres 15 efêmero real
// (mesmo harness de test/repositories/pipeline-lista.test.ts). Cada teste usa a própria empresa.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { HORARIO_PADRAO, type HorarioComercial } from '../../src/domain/atendimento/horario-comercial';
import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { obterMarketing } from '../../src/repositories/analises-marketing';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const USUARIO_SESSAO = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGORA = new Date('2026-02-20T12:00:00-03:00');
const FEVEREIRO = { de: '2026-02-01', ate: '2026-02-28' };

const contextoDe = (empresaId: string): ContextoTenant => ({ usuarioId: USUARIO_SESSAO, empresaId, papel: 'GERENTE', isSuperAdmin: false });

let contadorUuid = 0x10;
const proximoUuid = () => `dddddddd-7777-0000-0000-${(++contadorUuid).toString(16).padStart(12, '0')}`;

describe('fase6-atendimento-lead: velocidade do 1º contato no relatório de marketing', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  function executar(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    return resultado.stdout.trim();
  }

  let contadorEmpresa = 0;
  function criarEmpresa(): string {
    contadorEmpresa += 1;
    const id = proximoUuid();
    executar(`INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${id}', 'Empresa Velocidade ${contadorEmpresa}', 'empresa-velocidade-${contadorEmpresa}')`);
    return id;
  }

  function criarLead(empresaId: string, nome: string, entrada: string): string {
    const id = proximoUuid();
    executar(`INSERT INTO "leads" ("id", "empresa_id", "nome", "criado_em") VALUES ('${id}', '${empresaId}', '${nome}', '${entrada}'::timestamptz)`);
    return id;
  }

  function mensagem(empresaId: string, leadId: string, direcao: 'enviada' | 'recebida', quando: string): void {
    executar(
      `INSERT INTO "whatsapp_mensagens" ("empresa_id", "lead_id", "numero", "mensagem", "direcao", "criado_em") VALUES ('${empresaId}', '${leadId}', '5511999990000', 'oi', '${direcao}', '${quando}'::timestamptz)`
    );
  }

  function gravarHorario(empresaId: string, horario: HorarioComercial): void {
    executar(`INSERT INTO "empresa_configuracoes" ("empresa_id", "chave", "valor") VALUES ('${empresaId}', 'horario_atendimento', '${JSON.stringify(horario)}'::jsonb)`);
  }

  const velocidadeDe = async (empresaId: string) => (await obterMarketing(db, contextoDe(empresaId), { ...FEVEREIRO, agora: AGORA })).insights!.velocidade;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  test('conta só a 1ª mensagem enviada em ou depois da entrada; lead sem mensagem enviada fica de fora; só da empresa @spec:AC-804 @spec:AC-808', async () => {
    const empresa = criarEmpresa();
    const outra = criarEmpresa();

    // sexta 17h30 → segunda 9h30: 64 h corridas, 60 min em horário comercial (lead "migrado": entrada antiga, mensagem agora)
    const migrado = criarLead(empresa, 'Migrado', '2026-02-06T17:30:00-03:00');
    mensagem(empresa, migrado, 'enviada', '2026-02-09T09:30:00-03:00');
    mensagem(empresa, migrado, 'enviada', '2026-02-09T15:00:00-03:00'); // a 2ª mensagem não conta

    // mensagem antes da entrada é ignorada; vale a primeira depois dela (30 min)
    const comAntiga = criarLead(empresa, 'Com mensagem antiga', '2026-02-10T10:00:00-03:00');
    mensagem(empresa, comAntiga, 'enviada', '2026-02-10T09:00:00-03:00');
    mensagem(empresa, comAntiga, 'enviada', '2026-02-10T10:30:00-03:00');

    // só recebeu mensagem do cliente: sem contato nosso, fora da conta
    const soRecebida = criarLead(empresa, 'Só recebida', '2026-02-11T10:00:00-03:00');
    mensagem(empresa, soRecebida, 'recebida', '2026-02-11T10:05:00-03:00');
    // só tem mensagem enviada antes da entrada: fora da conta
    const soAntiga = criarLead(empresa, 'Só antiga', '2026-02-12T10:00:00-03:00');
    mensagem(empresa, soAntiga, 'enviada', '2026-02-12T09:00:00-03:00');
    // sem nenhuma mensagem: fora da conta
    criarLead(empresa, 'Sem mensagem', '2026-02-13T10:00:00-03:00');

    // lead de outra empresa, com contato rápido: nunca entra na conta desta
    const deOutra = criarLead(outra, 'De outra empresa', '2026-02-10T10:00:00-03:00');
    mensagem(outra, deOutra, 'enviada', '2026-02-10T10:01:00-03:00');

    const velocidade = await velocidadeDe(empresa);
    expect(velocidade.corrido).toMatchObject({ n: 2, media: 1935, mediana: 1935 }); // (3840 + 30) / 2
    expect(velocidade.comercial).toMatchObject({ n: 2, media: 45, mediana: 45 }); // (60 + 30) / 2
    expect(velocidade.horarioPadrao).toBe(true);
    expect(velocidade.horario).toEqual(HORARIO_PADRAO);

    // a empresa sem nenhum contato vê "Sem contatos"
    const semContatos = await velocidadeDe(criarEmpresa());
    expect(semContatos.corrido).toMatchObject({ n: 0, media: null, mediana: null });
  });

  test('o período filtra pela data de entrada do lead e as faixas somam N @spec:AC-806 @spec:AC-807', async () => {
    const empresa = criarEmpresa();
    const rapido = criarLead(empresa, 'Rápido', '2026-02-10T10:00:00-03:00');
    mensagem(empresa, rapido, 'enviada', '2026-02-10T10:20:00-03:00'); // 20 min
    const demorado = criarLead(empresa, 'Demorado', '2026-02-10T09:00:00-03:00');
    mensagem(empresa, demorado, 'enviada', '2026-02-12T09:00:00-03:00'); // 48 h
    const foraDoPeriodo = criarLead(empresa, 'Entrou em janeiro', '2026-01-20T10:00:00-03:00');
    mensagem(empresa, foraDoPeriodo, 'enviada', '2026-02-10T10:01:00-03:00');

    const { corrido } = await velocidadeDe(empresa);
    expect(corrido.n).toBe(2);
    expect(corrido.faixas.ate1h.quantidade).toBe(1);
    expect(corrido.faixas.mais24h.quantidade).toBe(1);
    const { ate1h, de1a4h, de4a24h, mais24h } = corrido.faixas;
    expect(ate1h.quantidade + de1a4h.quantidade + de4a24h.quantidade + mais24h.quantidade).toBe(corrido.n);
  });

  test('o novo horário passa a valer no cálculo: seg a sáb, 8h às 20h @spec:AC-812', async () => {
    const empresa = criarEmpresa();
    const lead = criarLead(empresa, 'Sábado', '2026-02-07T10:00:00-03:00'); // sábado
    mensagem(empresa, lead, 'enviada', '2026-02-07T11:00:00-03:00');

    expect((await velocidadeDe(empresa)).comercial.mediana).toBe(0); // no padrão, sábado não atende

    gravarHorario(empresa, {
      ...HORARIO_PADRAO,
      seg: { atende: true, abre: '08:00', fecha: '20:00' },
      sab: { atende: true, abre: '08:00', fecha: '20:00' },
    });
    const depois = await velocidadeDe(empresa);
    expect(depois.comercial.mediana).toBe(60);
    expect(depois.horarioPadrao).toBe(false);
    expect(depois.corrido.mediana).toBe(60);
  });
});

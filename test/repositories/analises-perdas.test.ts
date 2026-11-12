// fase6-perdas-por-lead (US-193/US-194): a perda por lead no card e nos relatórios, contra um Postgres 15 efêmero real (mesmo harness
// de test/repositories/pipeline-lista.test.ts). Cada teste usa a própria empresa, então o isolamento entre empresas também é provado.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { obterComercial } from '../../src/repositories/analises-comercial';
import { obterMarketing } from '../../src/repositories/analises-marketing';
import { comTenant } from '../../src/repositories/contexto';
import { lerPerdaDoCard } from '../../src/repositories/perda-do-card';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_EM_CONTATO = 5;
const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const USUARIO_SESSAO = 'aaaaaaaa-0000-0000-0000-000000000001';
const AGORA = new Date('2026-02-20T12:00:00-03:00');
const FEVEREIRO = { de: '2026-02-01', ate: '2026-02-28' };

const contextoDe = (empresaId: string): ContextoTenant => ({ usuarioId: USUARIO_SESSAO, empresaId, papel: 'GERENTE', isSuperAdmin: false });

let contadorUuid = 0x10;
const proximoUuid = () => `dddddddd-8888-0000-0000-${(++contadorUuid).toString(16).padStart(12, '0')}`;

describe('fase6-perdas-por-lead: perdas por lead', () => {
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
    executar(`INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${id}', 'Empresa Perdas ${contadorEmpresa}', 'empresa-perdas-${contadorEmpresa}')`);
    return id;
  }

  function criarUsuario(nome: string): string {
    const id = proximoUuid();
    executar(`INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${id}', '${id}@teste.local', '${nome}')`);
    return id;
  }

  function criarLead(empresaId: string, nome: string, entrada: string, especialidade = 'Dermatologia', origem = 'BM MedGuia'): string {
    const id = proximoUuid();
    executar(
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "origem", "dados", "criado_em") VALUES ('${id}', '${empresaId}', '${nome}', '${origem}', '{"especialidade":"${especialidade}"}'::jsonb, '${entrada}'::timestamptz)`
    );
    return id;
  }

  /** Card em Perdido (precisa de motivo, regra do banco), com o responsável e a transição que o levou até lá. */
  function criarPerdido(
    empresaId: string,
    leadId: string,
    opcoes: { motivo: string; responsavelId?: string; de?: number; quando?: string; criadoEm?: string }
  ): string {
    const id = proximoUuid();
    executar(
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id", "motivo_perda_id", "responsavel_id", "criado_em")
       VALUES ('${id}', '${empresaId}', '${leadId}', ${ETAPA_PERDIDO}, (SELECT id FROM motivos_perda WHERE nome = '${opcoes.motivo}'), ${opcoes.responsavelId ? `'${opcoes.responsavelId}'` : 'NULL'}, ${opcoes.criadoEm ? `'${opcoes.criadoEm}'::timestamptz` : 'now()'})`
    );
    if (opcoes.quando) {
      executar(
        `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_origem_id", "etapa_destino_id", "ator_tipo", "ocorrido_em")
         VALUES ('${empresaId}', '${id}', 'transicao_etapa', ${opcoes.de ?? ETAPA_ENTRADA}, ${ETAPA_PERDIDO}, 'sistema', '${opcoes.quando}'::timestamptz)`
      );
    }
    return id;
  }

  const nomeDaEtapa = (id: number) => executar(`SELECT nome FROM pipeline_etapas WHERE id = ${id}`);

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

  test('a perda do card traz motivo, etapa em que estava e quando; a última transição vale @spec:AC-813', async () => {
    const empresa = criarEmpresa();
    const lead = criarLead(empresa, 'Perdido de proposta', '2026-01-10T10:00:00-03:00');
    const card = criarPerdido(empresa, lead, { motivo: 'Preço/orçamento', de: ETAPA_PROPOSTA, quando: '2026-02-15T10:00:00-03:00' });
    // uma perda anterior (card reaberto e perdido de novo): vale a mais recente
    executar(
      `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_origem_id", "etapa_destino_id", "ator_tipo", "ocorrido_em")
       VALUES ('${empresa}', '${card}', 'transicao_etapa', ${ETAPA_ENTRADA}, ${ETAPA_PERDIDO}, 'sistema', '2026-01-20T10:00:00-03:00'::timestamptz)`
    );

    const perda = await comTenant(db, contextoDe(empresa), (tx) => lerPerdaDoCard(tx, empresa, { id: card, etapaId: ETAPA_PERDIDO }, 'Preço/orçamento'));
    expect(perda).toEqual({ motivo: 'Preço/orçamento', etapaOrigem: nomeDaEtapa(ETAPA_PROPOSTA), ocorridoEm: '2026-02-15T13:00:00.000Z', automatica: false });
  });

  test('card fora de Perdido (ou reaberto) não tem perda; card migrado sem a transição mostra o que sabe @spec:AC-814', async () => {
    const empresa = criarEmpresa();
    const lead = criarLead(empresa, 'Reaberto', '2026-01-10T10:00:00-03:00');
    const reaberto = proximoUuid();
    executar(`INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${reaberto}', '${empresa}', '${lead}', ${ETAPA_EM_CONTATO})`);
    executar(
      `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_origem_id", "etapa_destino_id", "ator_tipo", "ocorrido_em")
       VALUES ('${empresa}', '${reaberto}', 'transicao_etapa', ${ETAPA_ENTRADA}, ${ETAPA_PERDIDO}, 'sistema', '2026-01-20T10:00:00-03:00'::timestamptz)`
    ); // foi perdido um dia, mas hoje está em outra etapa

    const migrado = criarPerdido(empresa, criarLead(empresa, 'Migrado perdido', '2026-01-11T10:00:00-03:00'), { motivo: 'Sem interesse' }); // sem evento de transição

    const [fora, semEvento] = await comTenant(db, contextoDe(empresa), async (tx) => [
      await lerPerdaDoCard(tx, empresa, { id: reaberto, etapaId: ETAPA_EM_CONTATO }, null),
      await lerPerdaDoCard(tx, empresa, { id: migrado, etapaId: ETAPA_PERDIDO }, 'Sem interesse'),
    ]);
    expect(fora).toBeNull();
    expect(semEvento).toEqual({ motivo: 'Sem interesse', etapaOrigem: null, ocorridoEm: null, automatica: false });
  });

  test('a cadência esgotada é perda automática @spec:AC-815', async () => {
    const empresa = criarEmpresa();
    const card = criarPerdido(empresa, criarLead(empresa, 'Sem resposta', '2026-02-01T10:00:00-03:00'), { motivo: 'Cadência esgotada', de: 4, quando: '2026-02-10T08:00:00-03:00' });
    const perda = await comTenant(db, contextoDe(empresa), (tx) => lerPerdaDoCard(tx, empresa, { id: card, etapaId: ETAPA_PERDIDO }, 'Cadência esgotada'));
    expect(perda).toMatchObject({ motivo: 'Cadência esgotada', automatica: true });
  });

  test('a lista de leads perdidos é o mesmo conjunto do bloco de motivos, filtra por período, responsável e especialidade, e nunca mistura empresa @spec:AC-816 @spec:AC-818', async () => {
    const empresa = criarEmpresa();
    const outra = criarEmpresa();
    const ana = criarUsuario('Ana Perdas');
    const bruno = criarUsuario('Bruno Perdas');

    criarPerdido(empresa, criarLead(empresa, 'Alfa', '2026-01-05T10:00:00-03:00', 'Dermatologia'), { motivo: 'Preço/orçamento', responsavelId: ana, de: ETAPA_PROPOSTA, quando: '2026-02-15T10:00:00-03:00' });
    criarPerdido(empresa, criarLead(empresa, 'Beta', '2026-01-06T10:00:00-03:00', 'Cardiologia'), { motivo: 'Sem interesse', responsavelId: bruno, de: ETAPA_ENTRADA, quando: '2026-02-20T09:00:00-03:00' });
    criarPerdido(empresa, criarLead(empresa, 'Gama de março', '2026-01-07T10:00:00-03:00'), { motivo: 'Sem interesse', responsavelId: ana, quando: '2026-03-02T10:00:00-03:00' }); // fora do período
    criarPerdido(outra, criarLead(outra, 'De outra empresa', '2026-01-08T10:00:00-03:00'), { motivo: 'Sem interesse', quando: '2026-02-16T10:00:00-03:00' });

    const tudo = await obterComercial(db, contextoDe(empresa), { ...FEVEREIRO, agora: AGORA });
    expect(tudo.totalPerdas).toBe(2);
    expect(tudo.leadsPerdidos).toHaveLength(tudo.totalPerdas); // AC-816: as linhas são as perdas do bloco de motivos
    expect(tudo.leadsPerdidos.map((l) => l.lead)).toEqual(['Beta', 'Alfa']); // da mais recente para a mais antiga
    expect(tudo.leadsPerdidos[1]).toEqual({
      oportunidadeId: expect.any(String),
      lead: 'Alfa',
      responsavel: 'Ana Perdas',
      motivo: 'Preço/orçamento',
      etapaOrigem: nomeDaEtapa(ETAPA_PROPOSTA),
      origem: 'BM MedGuia',
      perdidoEm: '2026-02-15T13:00:00.000Z',
    });

    const daAna = await obterComercial(db, contextoDe(empresa), { ...FEVEREIRO, responsavelId: ana, agora: AGORA });
    expect(daAna.leadsPerdidos.map((l) => l.lead)).toEqual(['Alfa']);
    const dermato = await obterComercial(db, contextoDe(empresa), { ...FEVEREIRO, especialidade: 'Dermatologia', agora: AGORA });
    expect(dermato.leadsPerdidos.map((l) => l.lead)).toEqual(['Alfa']);
    const marco = await obterComercial(db, contextoDe(empresa), { de: '2026-03-01', ate: '2026-03-31', agora: AGORA });
    expect(marco.leadsPerdidos.map((l) => l.lead)).toEqual(['Gama de março']);
  });

  test('o marketing mostra quantos leads captados no período foram perdidos e os motivos, respeitando a origem @spec:AC-819', async () => {
    const empresa = criarEmpresa();
    // captados em fevereiro
    criarPerdido(empresa, criarLead(empresa, 'Captado perdido 1', '2026-02-05T10:00:00-03:00'), { motivo: 'Sem interesse', criadoEm: '2026-02-05T10:00:00-03:00' });
    criarPerdido(empresa, criarLead(empresa, 'Captado perdido 2', '2026-02-06T10:00:00-03:00'), { motivo: 'Sem interesse', criadoEm: '2026-02-06T10:00:00-03:00' });
    criarPerdido(empresa, criarLead(empresa, 'Captado perdido 3', '2026-02-07T10:00:00-03:00', 'Dermatologia', 'BM Dr. Felipe'), { motivo: 'Preço/orçamento', criadoEm: '2026-02-07T10:00:00-03:00' });
    const ativo = criarLead(empresa, 'Captado ativo', '2026-02-08T10:00:00-03:00');
    executar(`INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id", "criado_em") VALUES ('${empresa}', '${ativo}', ${ETAPA_ENTRADA}, '2026-02-08T10:00:00-03:00'::timestamptz)`);
    // captado em janeiro e perdido em fevereiro: não é "captado do período"
    criarPerdido(empresa, criarLead(empresa, 'Captado em janeiro', '2026-01-05T10:00:00-03:00'), { motivo: 'Sem interesse', criadoEm: '2026-01-05T10:00:00-03:00', quando: '2026-02-10T10:00:00-03:00' });

    const m = (await obterMarketing(db, contextoDe(empresa), { ...FEVEREIRO, agora: AGORA })).motivosDosCaptados!;
    expect(m).toMatchObject({ perdidos: 3, captados: 4 });
    expect(m.motivos).toEqual([
      { motivo: 'Sem interesse', quantidade: 2, percentual: 66.7 },
      { motivo: 'Preço/orçamento', quantidade: 1, percentual: 33.3 },
    ]);

    const soFelipe = (await obterMarketing(db, contextoDe(empresa), { ...FEVEREIRO, origem: 'BM Dr. Felipe', agora: AGORA })).motivosDosCaptados!;
    expect(soFelipe).toMatchObject({ perdidos: 1, captados: 1 });
    expect(soFelipe.motivos).toEqual([{ motivo: 'Preço/orçamento', quantidade: 1, percentual: 100 }]);

    const vazio = (await obterMarketing(db, contextoDe(criarEmpresa()), { ...FEVEREIRO, agora: AGORA })).motivosDosCaptados!;
    expect(vazio).toEqual({ perdidos: 0, captados: 0, motivos: [] });
  });

  test('a lista de leads do período traz o motivo só de quem está em Perdido @spec:AC-829', async () => {
    const empresa = criarEmpresa();
    criarPerdido(empresa, criarLead(empresa, 'Perdido', '2026-02-05T10:00:00-03:00'), { motivo: 'Preço/orçamento', criadoEm: '2026-02-05T10:00:00-03:00' });
    const ativo = criarLead(empresa, 'Ativo', '2026-02-06T10:00:00-03:00');
    executar(`INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id", "criado_em") VALUES ('${empresa}', '${ativo}', ${ETAPA_ENTRADA}, '2026-02-06T10:00:00-03:00'::timestamptz)`);
    criarLead(empresa, 'Sem card', '2026-02-07T10:00:00-03:00');

    const leads = (await obterMarketing(db, contextoDe(empresa), { ...FEVEREIRO, agora: AGORA })).leadsDoPeriodo!;
    const motivo = (nome: string) => leads.find((l) => l.nome === nome)?.motivoDaPerda;
    expect(motivo('Perdido')).toBe('Preço/orçamento');
    expect(motivo('Ativo')).toBeNull();
    expect(motivo('Sem card')).toBeNull();
  });
});

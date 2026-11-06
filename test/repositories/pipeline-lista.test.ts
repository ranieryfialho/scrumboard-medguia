// Testes de T-154 (fase4-pipeline-telas, US-106/US-107/US-108): repositórios
// de leitura das telas de lista, arquivados e indicadores, contra um
// Postgres 15 efêmero real com as migrations aplicadas (mesmo harness de
// test/repositories/oportunidades.test.ts e test/db/kpis.test.ts).
//
// Cada grupo de asserções usa a própria empresa (fixture isolada) em vez de
// um Postgres por teste — mais rápido, e já prova de quebra o isolamento
// entre tenants (AC-397/AC-402): se a função vazasse dados de outra
// empresa, os totais/itens não bateriam com os números fixos esperados
// aqui, porque sempre há pelo menos uma outra empresa com dados no mesmo
// banco quando a asserção corre.
//
// `mover_oportunidade`/`iniciar_cadencia` (funções SQL) não validam o grafo
// de `pipeline_transicoes` — quem decide isso é o domínio, chamado pela
// rota antes do repositório (comentário de oportunidades.ts/cadencia.ts) —
// por isso os fixtures aqui inserem a etapa e os eventos diretamente via
// `crm_migrator`, sem se preocupar com o grafo.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';
import {
  listarArquivados,
  listarLista,
  normalizarPorPagina,
} from '../../src/repositories/pipeline-lista';
import { obterIndicadoresArquivados, obterIndicadoresFunil } from '../../src/repositories/pipeline-indicadores';
import { iniciarCadencia } from '../../src/repositories/cadencia';
import type { ContextoTenant } from '../../src/lib/auth/tenant';

const ETAPA_ENTRADA = 1;
const ETAPA_1O_CONTATO = 2;
const ETAPA_2O_CONTATO = 3;
const ETAPA_PROPOSTA = 11;
const ETAPA_PERDIDO = 14;
const ETAPA_GANHO = 15;

const USUARIO_SESSAO = 'aaaaaaaa-0000-0000-0000-000000000001';

function contextoDe(empresaId: string): ContextoTenant {
  return { usuarioId: USUARIO_SESSAO, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `dddddddd-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

function sqlVal(v: string | null | undefined): string {
  return v == null ? 'NULL' : `'${v}'`;
}

describe('T-154: lista, arquivados e indicadores do pipeline', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  function executar(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao executar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  let contadorEmpresa = 0;
  function criarEmpresa(): string {
    contadorEmpresa += 1;
    const id = proximoUuid();
    executar(
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${id}', 'Empresa Pipeline ${contadorEmpresa}', 'empresa-pipeline-lista-${contadorEmpresa}')`
    );
    return id;
  }

  function criarLead(
    empresaId: string,
    nome: string,
    opts: { email?: string; telefoneE164?: string; origem?: string } = {}
  ): string {
    const id = proximoUuid();
    executar(
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "email", "telefone_e164", "origem")
       VALUES ('${id}', '${empresaId}', '${nome}', ${sqlVal(opts.email)}, ${sqlVal(opts.telefoneE164)}, ${sqlVal(opts.origem)})`
    );
    return id;
  }

  function criarUsuario(nome: string): string {
    const id = proximoUuid();
    executar(`INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${id}', '${id}@teste.local', '${nome}')`);
    return id;
  }

  interface DadosOportunidadeFixture {
    empresaId: string;
    leadId: string;
    etapaId: number;
    responsavelId?: string | null;
    valor?: number | null;
    proximaAcaoEm?: string | null;
    motivoPerdaId?: string | null;
    criadoEm?: string;
  }

  function criarOportunidadeFixture(dados: DadosOportunidadeFixture): string {
    const id = proximoUuid();
    const colunas = ['id', 'empresa_id', 'lead_id', 'etapa_id'];
    const valores = [`'${id}'`, `'${dados.empresaId}'`, `'${dados.leadId}'`, String(dados.etapaId)];

    if (dados.responsavelId !== undefined) {
      colunas.push('responsavel_id');
      valores.push(sqlVal(dados.responsavelId));
    }
    if (dados.valor !== undefined) {
      colunas.push('valor');
      valores.push(dados.valor === null ? 'NULL' : String(dados.valor));
    }
    if (dados.proximaAcaoEm !== undefined) {
      colunas.push('proxima_acao_em');
      valores.push(dados.proximaAcaoEm === null ? 'NULL' : `'${dados.proximaAcaoEm}'::timestamptz`);
    }
    if (dados.motivoPerdaId !== undefined) {
      colunas.push('motivo_perda_id');
      valores.push(sqlVal(dados.motivoPerdaId));
    }
    if (dados.criadoEm !== undefined) {
      colunas.push('criado_em');
      valores.push(`'${dados.criadoEm}'::timestamptz`);
    }

    executar(
      `INSERT INTO "oportunidades" (${colunas.map((c) => `"${c}"`).join(', ')}) VALUES (${valores.join(', ')})`
    );
    return id;
  }

  function inserirEventoTransicao(empresaId: string, oportunidadeId: string, etapaDestinoId: number, ocorridoEm: string): void {
    executar(
      `INSERT INTO "oportunidade_eventos" ("empresa_id", "oportunidade_id", "tipo", "etapa_destino_id", "ator_tipo", "ocorrido_em")
       VALUES ('${empresaId}', '${oportunidadeId}', 'transicao_etapa', ${etapaDestinoId}, 'sistema', '${ocorridoEm}'::timestamptz)`
    );
  }

  function motivoIdPorNome(nome: string): string {
    return executar(`SELECT id FROM motivos_perda WHERE nome = '${nome}'`);
  }

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

  describe('AC-397: a lista nunca mostra card de outra empresa', () => {
    test('listarLista da empresa B não traz nenhuma oportunidade da empresa A @spec:AC-397', async () => {
      const empresaA = criarEmpresa();
      const empresaB = criarEmpresa();
      const leadA = criarLead(empresaA, 'Lead Empresa A');
      const leadB = criarLead(empresaB, 'Lead Empresa B');
      criarOportunidadeFixture({ empresaId: empresaA, leadId: leadA, etapaId: ETAPA_ENTRADA });
      const oportunidadeB = criarOportunidadeFixture({ empresaId: empresaB, leadId: leadB, etapaId: ETAPA_ENTRADA });

      const resultado = await listarLista(db, contextoDe(empresaB));

      expect(resultado.itens.map((i) => i.id)).toEqual([oportunidadeB]);
      expect(resultado.total).toBe(1);
    });
  });

  describe('AC-398: a lista não traz cards arquivados', () => {
    test('cards em Perdido e Contrato (Ganho) não aparecem na lista, e o total os ignora @spec:AC-398', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Ativo e Arquivado');
      const motivo = motivoIdPorNome('Sem interesse');
      const ativo1 = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_ENTRADA });
      const ativo2 = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_2O_CONTATO });
      // Etapa 14 exige motivo (CHECK `oportunidades_perdido_exige_motivo`, drizzle/0002).
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_PERDIDO, motivoPerdaId: motivo });
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO });

      const resultado = await listarLista(db, contextoDe(empresa));

      expect(resultado.itens.map((i) => i.id).sort()).toEqual([ativo1, ativo2].sort());
      expect(resultado.total).toBe(2);
    });
  });

  describe('AC-395: o servidor pagina a lista', () => {
    test('porPagina fora de 10/20/25/50/100 vira 10 (função pura) @spec:AC-395', () => {
      expect(normalizarPorPagina(undefined)).toBe(10);
      expect(normalizarPorPagina(7)).toBe(10);
      expect(normalizarPorPagina(10)).toBe(10);
      expect(normalizarPorPagina(25)).toBe(25);
      expect(normalizarPorPagina(50)).toBe(50);
      expect(normalizarPorPagina(20)).toBe(20);
      expect(normalizarPorPagina(100)).toBe(100);
    });

    test('25 cards ativos, página 2 de tamanho 10 traz os cards 11 a 20 e o total geral (25) @spec:AC-395', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Paginação');
      const base = new Date('2026-01-01T00:00:00.000Z').getTime();

      const idsEmOrdem: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const criadoEm = new Date(base + i * 1000).toISOString();
        idsEmOrdem.push(
          criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_ENTRADA, criadoEm })
        );
      }

      const pagina2 = await listarLista(db, contextoDe(empresa), {
        pagina: 2,
        porPagina: 10,
        ordenarPor: 'criadoEm',
        ordem: 'asc',
      });

      expect(pagina2.total).toBe(25);
      expect(pagina2.pagina).toBe(2);
      expect(pagina2.porPagina).toBe(10);
      expect(pagina2.itens.map((i) => i.id)).toEqual(idsEmOrdem.slice(10, 20));
    });

    test('porPagina inválido na chamada real vira 10 @spec:AC-395', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Paginação Inválida');
      for (let i = 0; i < 3; i += 1) {
        criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_ENTRADA });
      }

      const resultado = await listarLista(db, contextoDe(empresa), { porPagina: 999 });

      expect(resultado.porPagina).toBe(10);
      expect(resultado.total).toBe(3);
    });
  });

  describe('AC-396: o servidor filtra e ordena a lista', () => {
    test('etapa, responsável e origem combinam com E, e o total reflete o filtro @spec:AC-396', async () => {
      const empresa = criarEmpresa();
      const resp1 = criarUsuario('Responsável 1');
      const resp2 = criarUsuario('Responsável 2');
      const leadGoogle = criarLead(empresa, 'Clínica Aurora', { origem: 'Google Ads' });
      const leadIndicacao = criarLead(empresa, 'Clínica Boreal', { origem: 'Indicação' });

      const alvo = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: leadGoogle,
        etapaId: ETAPA_1O_CONTATO,
        responsavelId: resp1,
      });
      // Mesma etapa, responsável diferente — excluído pelo filtro de responsável.
      criarOportunidadeFixture({ empresaId: empresa, leadId: leadGoogle, etapaId: ETAPA_1O_CONTATO, responsavelId: resp2 });
      // Mesma etapa e responsável, origem diferente — excluído pelo filtro de origem.
      criarOportunidadeFixture({ empresaId: empresa, leadId: leadIndicacao, etapaId: ETAPA_1O_CONTATO, responsavelId: resp1 });
      // Etapa diferente — excluído pelo filtro de etapa.
      criarOportunidadeFixture({ empresaId: empresa, leadId: leadGoogle, etapaId: ETAPA_2O_CONTATO, responsavelId: resp1 });

      const resultado = await listarLista(db, contextoDe(empresa), {
        etapaId: ETAPA_1O_CONTATO,
        responsavelId: resp1,
        origem: 'Google Ads',
      });

      expect(resultado.itens.map((i) => i.id)).toEqual([alvo]);
      expect(resultado.total).toBe(1);
    });

    test('a busca de texto acha por nome do lead, e-mail e telefone @spec:AC-396', async () => {
      const empresa = criarEmpresa();
      const leadBoreal = criarLead(empresa, 'Clínica Boreal', {
        email: 'contato@boreal-clinica.com',
        telefoneE164: '+5511900000099',
      });
      const leadOutro = criarLead(empresa, 'Outra Clínica', { email: 'outra@teste.com', telefoneE164: '+5511900000001' });
      const alvo = criarOportunidadeFixture({ empresaId: empresa, leadId: leadBoreal, etapaId: ETAPA_ENTRADA });
      criarOportunidadeFixture({ empresaId: empresa, leadId: leadOutro, etapaId: ETAPA_ENTRADA });

      const porNome = await listarLista(db, contextoDe(empresa), { busca: 'Boreal' });
      expect(porNome.itens.map((i) => i.id)).toEqual([alvo]);

      const porEmail = await listarLista(db, contextoDe(empresa), { busca: 'boreal-clinica.com' });
      expect(porEmail.itens.map((i) => i.id)).toEqual([alvo]);

      const porTelefone = await listarLista(db, contextoDe(empresa), { busca: '0099' });
      expect(porTelefone.itens.map((i) => i.id)).toEqual([alvo]);
    });

    test('ordena por valor e por próxima ação, nas duas direções @spec:AC-396', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Ordenação');
      const baixo = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_ENTRADA,
        valor: 1000,
        proximaAcaoEm: '2026-02-01T10:00:00-03:00',
      });
      const medio = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_ENTRADA,
        valor: 2000,
        proximaAcaoEm: '2026-02-03T10:00:00-03:00',
      });
      const alto = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_ENTRADA,
        valor: 3000,
        proximaAcaoEm: '2026-02-05T10:00:00-03:00',
      });

      const porValorAsc = await listarLista(db, contextoDe(empresa), { ordenarPor: 'valor', ordem: 'asc' });
      expect(porValorAsc.itens.map((i) => i.id)).toEqual([baixo, medio, alto]);

      const porValorDesc = await listarLista(db, contextoDe(empresa), { ordenarPor: 'valor', ordem: 'desc' });
      expect(porValorDesc.itens.map((i) => i.id)).toEqual([alto, medio, baixo]);

      const porProximaAcaoAsc = await listarLista(db, contextoDe(empresa), {
        ordenarPor: 'proximaAcao',
        ordem: 'asc',
      });
      expect(porProximaAcaoAsc.itens.map((i) => i.id)).toEqual([baixo, medio, alto]);
    });
  });

  describe('AC-389: os indicadores do topo do funil vêm dos dados reais', () => {
    test('cards ativos, valor somado, propostas ativas e toques em atraso só com dados da empresa @spec:AC-389', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Indicadores Funil');

      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_1O_CONTATO, valor: 1000 });
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_1O_CONTATO, valor: 2500 });
      // Etapa 11 (Proposta) exige valor > 0 e próxima ação futura (CHECKs de drizzle/0002).
      const proximaAcaoFutura = '2099-06-01T10:00:00-03:00';
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_PROPOSTA, valor: 100, proximaAcaoEm: proximaAcaoFutura });
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_PROPOSTA, valor: 200, proximaAcaoEm: proximaAcaoFutura });
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_PROPOSTA, valor: 300, proximaAcaoEm: proximaAcaoFutura });
      // Arquivado — nunca entra em "cards ativos".
      criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO, valor: 99999 });

      const atendente = criarUsuario('Atendente Cadência');
      const cardCadencia = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_ENTRADA });
      await iniciarCadencia(db, contextoDe(empresa), cardCadencia, {
        version: 1,
        atorId: atendente,
        atorTipo: 'usuario',
      });

      // `iniciarCadencia` libera os 3 toques no instante real (now()) — um
      // `agora` bem no futuro garante que os três contam como "atrasado"
      // sem depender do relógio da máquina que roda o teste.
      const agoraNoFuturo = new Date('2099-01-01T12:00:00-03:00');

      const resultado = await obterIndicadoresFunil(db, contextoDe(empresa), { agora: agoraNoFuturo });

      expect(resultado.cardsAtivos.quantidade).toBe(6);
      expect(Number(resultado.cardsAtivos.valorTotal)).toBe(4100);
      expect(resultado.propostasAtivas).toBe(3);
      expect(resultado.toquesEmAtraso).toBe(3);
    });

    test('taxa de conversão dos últimos 30 dias ignora fechamentos fora da janela @spec:AC-389', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Conversão 30 Dias');
      const agora = new Date('2026-06-15T12:00:00-03:00');

      const ganhoRecente = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO });
      inserirEventoTransicao(empresa, ganhoRecente, ETAPA_GANHO, '2026-06-10T10:00:00-03:00'); // 5 dias atrás

      const motivo = motivoIdPorNome('Sem interesse');
      const perdidoRecente = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_PERDIDO,
        motivoPerdaId: motivo,
      });
      inserirEventoTransicao(empresa, perdidoRecente, ETAPA_PERDIDO, '2026-06-05T10:00:00-03:00'); // 10 dias atrás

      const ganhoAntigo = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO });
      inserirEventoTransicao(empresa, ganhoAntigo, ETAPA_GANHO, '2026-05-06T10:00:00-03:00'); // 40 dias atrás

      const resultado = await obterIndicadoresFunil(db, contextoDe(empresa), { agora });

      expect(resultado.conversao30Dias).toEqual({ valor: 0.5, numerador: 1, denominador: 2 });
      // Nenhum dos três cards é "ativo" (todos terminais).
      expect(resultado.cardsAtivos.quantidade).toBe(0);
    });
  });

  describe('AC-402: os arquivados filtram e paginam no servidor', () => {
    test('filtra por tipo, motivo de perda, responsável, busca e período — e nunca mistura empresa, etapa ativa ou outro motivo @spec:AC-402', async () => {
      const motivoSemInteresse = motivoIdPorNome('Sem interesse');
      const motivoPreco = motivoIdPorNome('Preço/orçamento');

      const empresa = criarEmpresa();
      const outraEmpresa = criarEmpresa();
      const leadOutraEmpresa = criarLead(outraEmpresa, 'Lead de outra empresa');
      const arquivadoDeOutraEmpresa = criarOportunidadeFixture({
        empresaId: outraEmpresa,
        leadId: leadOutraEmpresa,
        etapaId: ETAPA_PERDIDO,
        motivoPerdaId: motivoSemInteresse,
      });
      inserirEventoTransicao(outraEmpresa, arquivadoDeOutraEmpresa, ETAPA_PERDIDO, '2026-05-15T10:00:00-03:00');

      const resp1 = criarUsuario('Responsável Arquivados 1');
      const resp2 = criarUsuario('Responsável Arquivados 2');

      const leadAlpha = criarLead(empresa, 'Perdido Alpha');
      const leadBeta = criarLead(empresa, 'Perdido Beta');
      const leadGamma = criarLead(empresa, 'Ganho Gamma');

      const perdidoAlpha = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: leadAlpha,
        etapaId: ETAPA_PERDIDO,
        responsavelId: resp1,
        motivoPerdaId: motivoSemInteresse,
      });
      inserirEventoTransicao(empresa, perdidoAlpha, ETAPA_PERDIDO, '2026-05-10T10:00:00-03:00');

      const perdidoBeta = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: leadBeta,
        etapaId: ETAPA_PERDIDO,
        responsavelId: resp2,
        motivoPerdaId: motivoPreco,
      });
      inserirEventoTransicao(empresa, perdidoBeta, ETAPA_PERDIDO, '2026-05-20T10:00:00-03:00');

      const ganhoGamma = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: leadGamma,
        etapaId: ETAPA_GANHO,
        responsavelId: resp1,
        valor: 5000,
      });
      inserirEventoTransicao(empresa, ganhoGamma, ETAPA_GANHO, '2026-05-15T10:00:00-03:00');

      // Card ativo — nunca aparece nos arquivados.
      criarOportunidadeFixture({ empresaId: empresa, leadId: leadAlpha, etapaId: ETAPA_ENTRADA });

      const todos = await listarArquivados(db, contextoDe(empresa));
      expect(todos.total).toBe(3);
      expect(todos.itens.map((i) => i.id).sort()).toEqual([perdidoAlpha, perdidoBeta, ganhoGamma].sort());

      const soPerdidos = await listarArquivados(db, contextoDe(empresa), { tipo: 'perdido' });
      expect(soPerdidos.total).toBe(2);
      expect(soPerdidos.itens.map((i) => i.id).sort()).toEqual([perdidoAlpha, perdidoBeta].sort());
      expect(soPerdidos.itens.every((i) => i.status === 'perdido')).toBe(true);

      const porMotivo = await listarArquivados(db, contextoDe(empresa), { motivoPerdaId: motivoSemInteresse });
      expect(porMotivo.itens.map((i) => i.id)).toEqual([perdidoAlpha]);
      expect(porMotivo.itens[0].motivoPerda?.nome).toBe('Sem interesse');

      const porResponsavel = await listarArquivados(db, contextoDe(empresa), { responsavelId: resp1 });
      expect(porResponsavel.itens.map((i) => i.id).sort()).toEqual([perdidoAlpha, ganhoGamma].sort());

      const porBusca = await listarArquivados(db, contextoDe(empresa), { busca: 'Gamma' });
      expect(porBusca.itens.map((i) => i.id)).toEqual([ganhoGamma]);

      const porPeriodo = await listarArquivados(db, contextoDe(empresa), { de: '2026-05-14', ate: '2026-05-16' });
      expect(porPeriodo.itens.map((i) => i.id)).toEqual([ganhoGamma]);

      // Tamanho de página válido (10/25/50, AC-395) com só 3 arquivados: a
      // página 1 traz os três e a página 2 vem vazia, sem perder o total.
      const pagina1 = await listarArquivados(db, contextoDe(empresa), { porPagina: 10, pagina: 1 });
      expect(pagina1.total).toBe(3);
      expect(pagina1.itens).toHaveLength(3);
      expect(pagina1.porPagina).toBe(10);
      const pagina2 = await listarArquivados(db, contextoDe(empresa), { porPagina: 10, pagina: 2 });
      expect(pagina2.total).toBe(3);
      expect(pagina2.itens).toHaveLength(0);
      expect(pagina2.pagina).toBe(2);
    });
  });

  describe('AC-403: os indicadores dos arquivados vêm dos dados reais', () => {
    test('valor ganho, negócios fechados, conversão final, perdas e distribuição de motivos no período pedido @spec:AC-403', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Indicadores Arquivados');
      const motivoSemInteresse = motivoIdPorNome('Sem interesse');
      const motivoPreco = motivoIdPorNome('Preço/orçamento');

      const ganho1 = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO, valor: 4000 });
      inserirEventoTransicao(empresa, ganho1, ETAPA_GANHO, '2026-08-05T10:00:00-03:00');
      const ganho2 = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO, valor: 6000 });
      inserirEventoTransicao(empresa, ganho2, ETAPA_GANHO, '2026-08-10T10:00:00-03:00');

      const perdido1 = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_PERDIDO,
        motivoPerdaId: motivoSemInteresse,
      });
      inserirEventoTransicao(empresa, perdido1, ETAPA_PERDIDO, '2026-08-07T10:00:00-03:00');
      const perdido2 = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_PERDIDO,
        motivoPerdaId: motivoSemInteresse,
      });
      inserirEventoTransicao(empresa, perdido2, ETAPA_PERDIDO, '2026-08-20T10:00:00-03:00');
      const perdido3 = criarOportunidadeFixture({
        empresaId: empresa,
        leadId: lead,
        etapaId: ETAPA_PERDIDO,
        motivoPerdaId: motivoPreco,
      });
      inserirEventoTransicao(empresa, perdido3, ETAPA_PERDIDO, '2026-08-12T10:00:00-03:00');

      // Fora do período pedido (de/ate de agosto) — nunca entra na conta.
      const ganhoFora = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO, valor: 999999 });
      inserirEventoTransicao(empresa, ganhoFora, ETAPA_GANHO, '2026-09-01T10:00:00-03:00');

      const resultado = await obterIndicadoresArquivados(db, contextoDe(empresa), {
        de: '2026-08-01',
        ate: '2026-08-31',
        agora: new Date('2026-08-25T12:00:00-03:00'),
      });

      expect(Number(resultado.valorGanho)).toBe(10000);
      expect(resultado.negociosFechados).toBe(5);
      expect(resultado.conversaoFinal).toEqual({ valor: 0.4, numerador: 2, denominador: 5 });
      expect(resultado.perdas).toEqual({
        quantidade: 3,
        taxaPerda: { valor: 0.6, numerador: 3, denominador: 5 },
      });

      const distribuicao = [...resultado.distribuicaoMotivos].sort((a, b) => a.motivo.localeCompare(b.motivo));
      expect(distribuicao).toEqual([
        { motivoId: motivoPreco, motivo: 'Preço/orçamento', quantidade: 1, percentual: 1 / 3 },
        { motivoId: motivoSemInteresse, motivo: 'Sem interesse', quantidade: 2, percentual: 2 / 3 },
      ]);
    });

    test('sem de/ate, o período padrão é o mês corrente de `agora` (mesma regra de limitesDoPeriodo) @spec:AC-403', async () => {
      const empresa = criarEmpresa();
      const lead = criarLead(empresa, 'Lead Mês Corrente');

      const ganhoNoMes = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO, valor: 7000 });
      inserirEventoTransicao(empresa, ganhoNoMes, ETAPA_GANHO, '2026-07-05T10:00:00-03:00');

      const ganhoMesAnterior = criarOportunidadeFixture({ empresaId: empresa, leadId: lead, etapaId: ETAPA_GANHO, valor: 1234 });
      inserirEventoTransicao(empresa, ganhoMesAnterior, ETAPA_GANHO, '2026-06-25T10:00:00-03:00');

      const resultado = await obterIndicadoresArquivados(db, contextoDe(empresa), {
        agora: new Date('2026-07-20T12:00:00-03:00'),
      });

      expect(Number(resultado.valorGanho)).toBe(7000);
      expect(resultado.negociosFechados).toBe(1);
    });

    test('nunca mistura o valor ganho de outra empresa, mesmo com fechamentos dela no mesmo período @spec:AC-403', async () => {
      const empresaJ = criarEmpresa();
      const empresaK = criarEmpresa();
      const leadJ = criarLead(empresaJ, 'Lead Empresa J');
      const leadK = criarLead(empresaK, 'Lead Empresa K');

      const ganhoJ = criarOportunidadeFixture({ empresaId: empresaJ, leadId: leadJ, etapaId: ETAPA_GANHO, valor: 100 });
      inserirEventoTransicao(empresaJ, ganhoJ, ETAPA_GANHO, '2026-10-05T10:00:00-03:00');
      const ganhoK = criarOportunidadeFixture({ empresaId: empresaK, leadId: leadK, etapaId: ETAPA_GANHO, valor: 999 });
      inserirEventoTransicao(empresaK, ganhoK, ETAPA_GANHO, '2026-10-06T10:00:00-03:00');

      const resultado = await obterIndicadoresArquivados(db, contextoDe(empresaJ), {
        de: '2026-10-01',
        ate: '2026-10-31',
        agora: new Date('2026-10-15T12:00:00-03:00'),
      });

      expect(Number(resultado.valorGanho)).toBe(100);
      expect(resultado.negociosFechados).toBe(1);
    });
  });
});

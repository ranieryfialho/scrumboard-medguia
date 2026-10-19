// Testes de T-104 (fase2d-campanhas): repositório de campanhas e envios,
// contra um Postgres 15 efêmero real (mesmo harness de
// test/repositories/cadencia.test.ts e test/repositories/anexos.test.ts).
// Fixtures de empresa/lead/usuário/oportunidade entram via `crm_migrator`
// (bypassa RLS); o repositório sob teste é exercido pela conexão `crm_app`
// (RLS ativo), como em produção. Status de destinatário fora do alcance do
// repositório (ENVIADO, ABERTO, CLICADO, ERRO — contrato do motor em
// Python, ASM-075) também entram via `crm_migrator`, simulando o que o
// motor externo gravaria.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  buscarDetalheCampanha,
  criarCampanha,
  excluirCampanha,
  ErroCampanhaEmEnvio,
  ErroCampanhaJaIniciada,
  ErroCampanhaNaoEncontrada,
  ErroSemDestinatarios,
  ErroSemFalhas,
  iniciarCampanha,
  listarCampanhas,
  normalizarDestinatarios,
  reenviarFalhas,
} from '../../src/repositories/campanhas';
import type { ContextoTenant } from '../../src/lib/auth/tenant';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_QUALIFICANDO = 5;

const EMPRESA_A = 'ffffffff-0000-0000-0000-00000000000a';
const EMPRESA_B = 'ffffffff-0000-0000-0000-00000000000b';
const USUARIO_A = 'ffffffff-0000-0000-0000-00000000001a';
const USUARIO_B = 'ffffffff-0000-0000-0000-00000000001b';

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `ffffffff-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

function contextoDe(empresaId: string, usuarioId: string): ContextoTenant {
  return { usuarioId, empresaId, papel: 'GERENTE', isSuperAdmin: false };
}

describe('T-104: repositório de campanhas e envios', () => {
  let pg: PostgresEfemero;
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Repo Campanhas A', 'empresa-teste-repo-campanhas-a'),
         ('${EMPRESA_B}', 'Empresa Teste Repo Campanhas B', 'empresa-teste-repo-campanhas-b');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${USUARIO_A}', 'gerente-campanhas-a@teste.local', 'Gerente Campanhas A'),
         ('${USUARIO_B}', 'gerente-campanhas-b@teste.local', 'Gerente Campanhas B');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes do repositório de campanhas: ${setup.stderr}`);
    }

    pool = new Pool({ connectionString: pg.appUrl });
    db = drizzle(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    pg?.parar();
  });

  function valor(sqlTexto: string): string {
    const resultado = pg.psqlComo('crm_migrator', sqlTexto);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao consultar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function valorJson<T = unknown>(sqlTexto: string): T {
    return JSON.parse(valor(sqlTexto)) as T;
  }

  function criarLeadEOportunidade(
    empresaId: string,
    nome: string,
    email: string | null,
    etapaId: number
  ): { leadId: string; oportunidadeId: string } {
    const leadId = proximoUuid();
    const oportunidadeId = proximoUuid();
    const emailSql = email === null ? 'NULL' : `'${email}'`;
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "leads" ("id", "empresa_id", "nome", "email") VALUES ('${leadId}', '${empresaId}', '${nome}', ${emailSql});
       INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${oportunidadeId}', '${empresaId}', '${leadId}', ${etapaId});`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar lead/oportunidade fixture: ${resultado.stderr}`);
    }
    return { leadId, oportunidadeId };
  }

  function statusCampanha(campanhaId: string): string {
    return valor(`SELECT status FROM campanhas WHERE id = '${campanhaId}'`);
  }

  function contarCampanhas(campanhaId: string): number {
    return Number(valor(`SELECT count(*) FROM campanhas WHERE id = '${campanhaId}'`));
  }

  function contarDestinatarios(campanhaId: string): number {
    return Number(valor(`SELECT count(*) FROM envios_campanha WHERE campanha_id = '${campanhaId}'`));
  }

  interface DestinatarioLinha {
    nome_destinatario: string;
    email_destinatario: string;
    status: string;
  }

  function destinatariosOrdenados(campanhaId: string): DestinatarioLinha[] {
    return valorJson<DestinatarioLinha[]>(
      `SELECT coalesce(json_agg(t), '[]'::json) FROM (
         SELECT nome_destinatario, email_destinatario, status
         FROM envios_campanha WHERE campanha_id = '${campanhaId}' ORDER BY nome_destinatario
       ) t`
    );
  }

  /** Insere um destinatário com um status fora do alcance do repositório (ASM-075: contrato só do motor Python). */
  function inserirDestinatarioComStatus(
    campanhaId: string,
    empresaId: string,
    nome: string,
    email: string,
    status: string
  ): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "envios_campanha" ("id", "empresa_id", "campanha_id", "nome_destinatario", "email_destinatario", "status")
       VALUES ('${id}', '${empresaId}', '${campanhaId}', '${nome}', '${email}', '${status}')`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao inserir destinatário fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function definirStatusCampanha(campanhaId: string, status: string): void {
    const resultado = pg.psqlComo('crm_migrator', `UPDATE campanhas SET status = '${status}' WHERE id = '${campanhaId}'`);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao forçar status de campanha fixture: ${resultado.stderr}`);
    }
  }

  describe('AC-234: criar campanha em rascunho com destinatários de uma planilha', () => {
    test('campanha nasce RASCUNHO na empresa do contexto, com um destinatário RASCUNHO por contato @spec:AC-234', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);

      const resultado = await criarCampanha(db, contexto, {
        nome: 'Campanha planilha',
        assunto: 'Assunto planilha',
        corpoHtml: '<p>corpo</p>',
        criadoPor: USUARIO_A,
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'Contato Um', email: 'contato.um@teste.local' },
            { nome: 'Contato Dois', email: 'contato.dois@teste.local' },
          ],
        },
      });

      expect(resultado.campanha.id).toBeTruthy();
      expect(resultado.campanha.empresaId).toBe(EMPRESA_A);
      expect(resultado.campanha.status).toBe('RASCUNHO');
      expect(resultado.totalDestinatarios).toBe(2);

      expect(contarDestinatarios(resultado.campanha.id)).toBe(2);
      const destinatarios = destinatariosOrdenados(resultado.campanha.id);
      expect(destinatarios.every((d) => d.status === 'RASCUNHO')).toBe(true);
    });
  });

  describe('AC-235: criar campanha com os cards de uma etapa do pipeline', () => {
    test('só os leads com e-mail da etapa escolhida, do tenant do contexto, viram destinatários @spec:AC-235', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);

      // card da etapa certa, com e-mail (com espaços nas pontas, para provar o trim).
      const comEmail = criarLeadEOportunidade(EMPRESA_A, 'Lead Com Email', '  etapa.comemail@teste.local  ', ETAPA_QUALIFICANDO);
      // card da etapa certa, sem e-mail — não deve entrar.
      criarLeadEOportunidade(EMPRESA_A, 'Lead Sem Email', null, ETAPA_QUALIFICANDO);
      // card de outra etapa, com e-mail — não deve entrar.
      criarLeadEOportunidade(EMPRESA_A, 'Lead Outra Etapa', 'etapa.outraetapa@teste.local', ETAPA_ENTRADA);
      // card de outra empresa, na mesma etapa, com e-mail — não deve entrar.
      criarLeadEOportunidade(EMPRESA_B, 'Lead Outra Empresa', 'etapa.outraempresa@teste.local', ETAPA_QUALIFICANDO);

      const resultado = await criarCampanha(db, contexto, {
        nome: 'Campanha etapa',
        assunto: 'Assunto etapa',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'etapa', etapaId: ETAPA_QUALIFICANDO },
      });

      expect(resultado.totalDestinatarios).toBe(1);
      const destinatarios = destinatariosOrdenados(resultado.campanha.id);
      expect(destinatarios).toHaveLength(1);
      expect(destinatarios[0].nome_destinatario).toBe('Lead Com Email');
      expect(destinatarios[0].email_destinatario).toBe('etapa.comemail@teste.local');
      void comEmail;
    });
  });

  describe('AC-236: e-mails inválidos e repetidos são descartados e contados', () => {
    test('função pura: inválidos e repetidos (sem diferenciar maiúsculas) são descartados e contados separadamente @spec:AC-236', () => {
      const resultado = normalizarDestinatarios([
        { nome: 'Valido Um', email: 'valido.um@teste.local' },
        { nome: 'Invalido', email: 'nao-e-email' },
        { nome: 'Valido Repetido', email: 'VALIDO.UM@teste.local' },
        { nome: 'Invalido Dois', email: 'sem-arroba.teste.local' },
        { nome: 'Valido Dois', email: '  valido.dois@teste.local  ' },
      ]);

      expect(resultado.destinatarios).toHaveLength(2);
      expect(resultado.destinatarios.map((d) => d.email).sort()).toEqual(['valido.dois@teste.local', 'valido.um@teste.local']);
      expect(resultado.descartadosInvalidos).toBe(2);
      expect(resultado.descartadosRepetidos).toBe(1);
    });

    test('criarCampanha grava só os válidos e únicos, e devolve as duas contagens de descarte @spec:AC-236', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);

      const resultado = await criarCampanha(db, contexto, {
        nome: 'Campanha com descartes',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'A', email: 'descarte.a@teste.local' },
            { nome: 'A repetido', email: 'DESCARTE.A@teste.local' },
            { nome: 'Invalido', email: 'invalido-sem-dominio' },
          ],
        },
      });

      expect(resultado.totalDestinatarios).toBe(1);
      expect(resultado.descartadosRepetidos).toBe(1);
      expect(resultado.descartadosInvalidos).toBe(1);
      expect(contarDestinatarios(resultado.campanha.id)).toBe(1);
    });
  });

  describe('AC-239: Play libera a fila para o motor', () => {
    test('campanha RASCUNHO vira PROCESSANDO e os destinatários RASCUNHO viram PENDENTE, na mesma transação; outros status não mudam @spec:AC-239', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha play',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'Play Um', email: 'play.um@teste.local' },
            { nome: 'Play Dois', email: 'play.dois@teste.local' },
          ],
        },
      });
      // destinatário fora do fluxo normal (nunca existiria numa campanha ainda RASCUNHO),
      // só para provar que o UPDATE condicional não toca em quem não está RASCUNHO.
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Já Enviado', 'ja.enviado@teste.local', 'ENVIADO');

      const resultado = await iniciarCampanha(db, contexto, criada.campanha.id);

      expect(resultado.campanha.status).toBe('PROCESSANDO');
      expect(resultado.totalLiberados).toBe(2);
      expect(statusCampanha(criada.campanha.id)).toBe('PROCESSANDO');

      const destinatarios = destinatariosOrdenados(criada.campanha.id);
      const porEmail = new Map(destinatarios.map((d) => [d.email_destinatario, d.status]));
      expect(porEmail.get('play.um@teste.local')).toBe('PENDENTE');
      expect(porEmail.get('play.dois@teste.local')).toBe('PENDENTE');
      expect(porEmail.get('ja.enviado@teste.local')).toBe('ENVIADO');
    });
  });

  describe('AC-240: Play recusado quando não há o que enviar ou já foi iniciada', () => {
    test('campanha sem nenhum destinatário: 422 SEM_DESTINATARIOS e nada é alterado @spec:AC-240', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha vazia',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });

      await expect(iniciarCampanha(db, contexto, criada.campanha.id)).rejects.toThrow(ErroSemDestinatarios);
      expect(statusCampanha(criada.campanha.id)).toBe('RASCUNHO');
    });

    test('campanha já PROCESSANDO ou FINALIZADA: 409 CAMPANHA_JA_INICIADA e nada é alterado @spec:AC-240', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);

      const processando = await criarCampanha(db, contexto, {
        nome: 'Já processando',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [{ nome: 'X', email: 'x.processando@teste.local' }] },
      });
      definirStatusCampanha(processando.campanha.id, 'PROCESSANDO');
      await expect(iniciarCampanha(db, contexto, processando.campanha.id)).rejects.toThrow(ErroCampanhaJaIniciada);
      expect(statusCampanha(processando.campanha.id)).toBe('PROCESSANDO');

      const finalizada = await criarCampanha(db, contexto, {
        nome: 'Já finalizada',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [{ nome: 'Y', email: 'y.finalizada@teste.local' }] },
      });
      definirStatusCampanha(finalizada.campanha.id, 'FINALIZADA');
      await expect(iniciarCampanha(db, contexto, finalizada.campanha.id)).rejects.toThrow(ErroCampanhaJaIniciada);
      expect(statusCampanha(finalizada.campanha.id)).toBe('FINALIZADA');
    });

    test('campanha inexistente: ErroCampanhaNaoEncontrada @spec:AC-240', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      await expect(iniciarCampanha(db, contexto, proximoUuid())).rejects.toThrow(ErroCampanhaNaoEncontrada);
    });

    test('dois cliques simultâneos iniciam a campanha uma única vez @spec:AC-240', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha clique duplo',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'Duplo Um', email: 'duplo.um@teste.local' },
            { nome: 'Duplo Dois', email: 'duplo.dois@teste.local' },
          ],
        },
      });

      const resultados = await Promise.allSettled([
        iniciarCampanha(db, contexto, criada.campanha.id),
        iniciarCampanha(db, contexto, criada.campanha.id),
      ]);

      const sucesso = resultados.filter((r) => r.status === 'fulfilled');
      const falha = resultados.filter((r) => r.status === 'rejected');
      expect(sucesso).toHaveLength(1);
      expect(falha).toHaveLength(1);
      expect((falha[0] as PromiseRejectedResult).reason).toBeInstanceOf(ErroCampanhaJaIniciada);
      expect((sucesso[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof iniciarCampanha>>>).value.totalLiberados).toBe(2);

      expect(statusCampanha(criada.campanha.id)).toBe('PROCESSANDO');
      const destinatarios = destinatariosOrdenados(criada.campanha.id);
      expect(destinatarios.every((d) => d.status === 'PENDENTE')).toBe(true);
    });
  });

  describe('AC-241: reenviar falhas devolve os erros para a fila', () => {
    test('só os destinatários ERRO viram PENDENTE, a campanha volta a PROCESSANDO, e a contagem de devolvidos está correta @spec:AC-241', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha reenviar',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      definirStatusCampanha(criada.campanha.id, 'FINALIZADA');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Enviado Um', 'enviado.um@teste.local', 'ENVIADO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Erro Um', 'erro.um@teste.local', 'ERRO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Erro Dois', 'erro.dois@teste.local', 'ERRO');

      const resultado = await reenviarFalhas(db, contexto, criada.campanha.id);

      expect(resultado.totalReenviados).toBe(2);
      expect(resultado.campanha.status).toBe('PROCESSANDO');
      expect(statusCampanha(criada.campanha.id)).toBe('PROCESSANDO');

      const porEmail = new Map(destinatariosOrdenados(criada.campanha.id).map((d) => [d.email_destinatario, d.status]));
      expect(porEmail.get('enviado.um@teste.local')).toBe('ENVIADO');
      expect(porEmail.get('erro.um@teste.local')).toBe('PENDENTE');
      expect(porEmail.get('erro.dois@teste.local')).toBe('PENDENTE');
    });

    test('sem nenhum ERRO: 422 SEM_FALHAS e nada é alterado @spec:AC-241', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha sem falhas',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      definirStatusCampanha(criada.campanha.id, 'FINALIZADA');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Enviado', 'sem.falha@teste.local', 'ENVIADO');

      await expect(reenviarFalhas(db, contexto, criada.campanha.id)).rejects.toThrow(ErroSemFalhas);
      expect(statusCampanha(criada.campanha.id)).toBe('FINALIZADA');
    });
  });

  describe('AC-242: a campanha finaliza quando a fila acaba', () => {
    test('PROCESSANDO sem nenhum PENDENTE nem RASCUNHO vira FINALIZADA ao consultar o detalhe @spec:AC-242', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha finalizando',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      definirStatusCampanha(criada.campanha.id, 'PROCESSANDO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Enviado', 'finaliza.enviado@teste.local', 'ENVIADO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Erro', 'finaliza.erro@teste.local', 'ERRO');

      const detalhe = await buscarDetalheCampanha(db, contexto, criada.campanha.id);

      expect(detalhe.campanha.status).toBe('FINALIZADA');
      expect(statusCampanha(criada.campanha.id)).toBe('FINALIZADA');
    });

    test('PROCESSANDO com ao menos um PENDENTE continua PROCESSANDO @spec:AC-242', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha ainda processando',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      definirStatusCampanha(criada.campanha.id, 'PROCESSANDO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Enviado', 'continua.enviado@teste.local', 'ENVIADO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Pendente', 'continua.pendente@teste.local', 'PENDENTE');

      const detalhe = await buscarDetalheCampanha(db, contexto, criada.campanha.id);

      expect(detalhe.campanha.status).toBe('PROCESSANDO');
      expect(statusCampanha(criada.campanha.id)).toBe('PROCESSANDO');
    });
  });

  describe('AC-243: listar as campanhas da empresa', () => {
    test('só as campanhas da própria empresa, da mais nova para a mais antiga, com nome/assunto/status/total @spec:AC-243', async () => {
      const contextoA = contextoDe(EMPRESA_A, USUARIO_A);
      const contextoB = contextoDe(EMPRESA_B, USUARIO_B);

      const primeira = await criarCampanha(db, contextoA, {
        nome: 'Lista Primeira',
        assunto: 'Assunto 1',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [{ nome: 'L1', email: 'lista.primeira@teste.local' }] },
      });
      const segunda = await criarCampanha(db, contextoA, {
        nome: 'Lista Segunda',
        assunto: 'Assunto 2',
        corpoHtml: '<p>corpo</p>',
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'L2', email: 'lista.segunda.a@teste.local' },
            { nome: 'L2b', email: 'lista.segunda.b@teste.local' },
          ],
        },
      });
      await criarCampanha(db, contextoB, {
        nome: 'Lista Outra Empresa',
        assunto: 'Assunto B',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [{ nome: 'LB', email: 'lista.outraempresa@teste.local' }] },
      });

      const lista = await listarCampanhas(db, contextoA);

      expect(lista.every((item) => item.campanha.empresaId === EMPRESA_A)).toBe(true);
      expect(lista.some((item) => item.campanha.nome === 'Lista Outra Empresa')).toBe(false);

      const indiceSegunda = lista.findIndex((item) => item.campanha.id === segunda.campanha.id);
      const indicePrimeira = lista.findIndex((item) => item.campanha.id === primeira.campanha.id);
      expect(indiceSegunda).toBeGreaterThanOrEqual(0);
      expect(indicePrimeira).toBeGreaterThan(indiceSegunda);

      const itemSegunda = lista.find((item) => item.campanha.id === segunda.campanha.id)!;
      expect(itemSegunda.campanha.nome).toBe('Lista Segunda');
      expect(itemSegunda.campanha.assunto).toBe('Assunto 2');
      expect(itemSegunda.campanha.status).toBe('RASCUNHO');
      expect(itemSegunda.totalDestinatarios).toBe(2);
    });
  });

  describe('AC-244: detalhe com destinatários e contagem por status', () => {
    test('traz a campanha, os destinatários ordenados por nome e a contagem por status @spec:AC-244', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha detalhe',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Zeta', 'zeta@teste.local', 'PENDENTE');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Alfa', 'alfa@teste.local', 'ENVIADO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Beta', 'beta@teste.local', 'ABERTO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Delta', 'delta@teste.local', 'CLICADO');
      inserirDestinatarioComStatus(criada.campanha.id, EMPRESA_A, 'Gama', 'gama@teste.local', 'ERRO');

      const detalhe = await buscarDetalheCampanha(db, contexto, criada.campanha.id);

      expect(detalhe.campanha.id).toBe(criada.campanha.id);
      expect(detalhe.destinatarios.map((d) => d.nomeDestinatario)).toEqual(['Alfa', 'Beta', 'Delta', 'Gama', 'Zeta']);
      expect(detalhe.contagemPorStatus).toEqual({
        PENDENTE: 1,
        ENVIADO: 1,
        ABERTO: 1,
        CLICADO: 1,
        ERRO: 1,
      });
    });

    test('campanha de outra empresa ou inexistente: ErroCampanhaNaoEncontrada @spec:AC-244', async () => {
      const contextoA = contextoDe(EMPRESA_A, USUARIO_A);
      const contextoB = contextoDe(EMPRESA_B, USUARIO_B);
      const deOutraEmpresa = await criarCampanha(db, contextoB, {
        nome: 'Campanha da empresa B',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [] },
      });

      await expect(buscarDetalheCampanha(db, contextoA, deOutraEmpresa.campanha.id)).rejects.toThrow(
        ErroCampanhaNaoEncontrada
      );
      await expect(buscarDetalheCampanha(db, contextoA, proximoUuid())).rejects.toThrow(ErroCampanhaNaoEncontrada);
    });
  });

  describe('AC-245: excluir a campanha apaga os envios', () => {
    test('a campanha e todos os seus destinatários deixam de existir @spec:AC-245', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha para excluir',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: {
          tipo: 'planilha',
          contatos: [
            { nome: 'Excluir Um', email: 'excluir.um@teste.local' },
            { nome: 'Excluir Dois', email: 'excluir.dois@teste.local' },
          ],
        },
      });
      expect(contarDestinatarios(criada.campanha.id)).toBe(2);

      await excluirCampanha(db, contexto, criada.campanha.id);

      expect(contarCampanhas(criada.campanha.id)).toBe(0);
      expect(contarDestinatarios(criada.campanha.id)).toBe(0);
    });

    test('campanha PROCESSANDO não pode ser excluída: 409 CAMPANHA_EM_ENVIO @spec:AC-245', async () => {
      const contexto = contextoDe(EMPRESA_A, USUARIO_A);
      const criada = await criarCampanha(db, contexto, {
        nome: 'Campanha processando não exclui',
        assunto: 'Assunto',
        corpoHtml: '<p>corpo</p>',
        origem: { tipo: 'planilha', contatos: [{ nome: 'P', email: 'processando.exclui@teste.local' }] },
      });
      definirStatusCampanha(criada.campanha.id, 'PROCESSANDO');

      await expect(excluirCampanha(db, contexto, criada.campanha.id)).rejects.toThrow(ErroCampanhaEmEnvio);
      expect(contarCampanhas(criada.campanha.id)).toBe(1);
    });
  });
});

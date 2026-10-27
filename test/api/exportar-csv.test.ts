// Testes de T-179 (fase4-pipeline-lote, US-118): exportação em CSV da lista e dos
// arquivados, contra um Postgres 15 efêmero real com dois tenants
// (test/support/api-anexos.ts). Provam os filtros (tudo que casa, não só a
// página), o papel, a segurança do arquivo, o teto e o registro append-only.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { criarAuth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const SENHA = 'senha-correta-123';
const CABECALHO_LISTA = 'Lead;Telefone;E-mail;Origem;Etapa;Responsável;Valor;Próxima ação;Criado em';
const CABECALHO_ARQUIVADOS = 'Lead;Status;Consultor;Valor;Motivo da perda;Data de fechamento';

describe('T-179: exportar em CSV (servidor)', () => {
  let amb: AmbienteAnexos;
  let rotaLista: typeof import('../../src/app/api/oportunidades/lista/exportar/route');
  let rotaArquivados: typeof import('../../src/app/api/oportunidades/arquivados/exportar/route');
  let cookieAtendente: string;
  let empresaA: string;

  function exportar(
    rota: { GET: (r: NextRequest) => Promise<Response> },
    caminho: string,
    cookie: string | null,
    consulta = ''
  ) {
    return rota.GET(
      new NextRequest(`http://localhost/api/oportunidades/${caminho}/exportar${consulta}`, {
        headers: cookie ? { Cookie: cookie } : undefined,
      })
    );
  }

  function sql(comando: string, como: 'crm_migrator' | 'crm_app' = 'crm_migrator'): string {
    const resultado = amb.pg.psqlComo(como, comando);
    if (resultado.status !== 0) throw new Error(`Falha no SQL de preparo: ${resultado.stderr}`);
    return resultado.stdout.trim();
  }

  const registros = () => Number(sql(`SELECT count(*) FROM "auditoria_exportacoes"`));

  /** O corpo sem o BOM, separado em linhas (só serve para arquivos sem quebra de linha dentro de campo). */
  function linhasDe(csv: string): string[] {
    return csv.replace(/^﻿/, '').split('\r\n').filter((linha) => linha !== '');
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    empresaA = amb.tenants.empresaA;
    rotaLista = await import('../../src/app/api/oportunidades/lista/exportar/route');
    rotaArquivados = await import('../../src/app/api/oportunidades/arquivados/exportar/route');

    const ator: AtorConvite = { usuarioId: 'ffffffff-0000-0000-0000-0000000000f9', empresaId: empresaA, papel: 'MASTER', isSuperAdmin: false };
    const convite = await convidarUsuario(amb.db, ator, { email: 'atendente.exporta@teste.com', papel: 'ATENDENTE' });
    await definirSenhaComToken(amb.db, convite.token, SENHA);
    const resposta = await criarAuth(amb.db).api.signInEmail({
      body: { email: 'atendente.exporta@teste.com', password: SENHA },
      asResponse: true,
    });
    const cookie = (resposta.headers.getSetCookie?.() ?? []).find((c) => c.includes('better-auth.session_token='));
    cookieAtendente = cookie ? cookie.split(';')[0] : '';

    // 60 cards ativos de origem "Lote" (mais que uma página de 50), todos em "1º dia de contato".
    sql(
      `WITH novos AS (
         INSERT INTO "leads" ("empresa_id", "nome", "origem", "telefone_e164", "email")
         SELECT '${empresaA}', 'Lead Lote ' || lpad(g::text, 3, '0'), 'Lote', '55119' || lpad(g::text, 8, '0'), 'lote' || g || '@teste.com'
         FROM generate_series(1, 60) g RETURNING "id"
       )
       INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id", "valor")
       SELECT '${empresaA}', "id", 2, 1500.5 FROM novos;`
    );

    // Nomes que o Excel poderia tratar como fórmula ou que quebram o CSV.
    sql(
      `WITH especiais AS (
         INSERT INTO "leads" ("empresa_id", "nome", "origem") VALUES
           ('${empresaA}', $$Clínica "Alfa"; Beta$$, 'Especiais'),
           ('${empresaA}', $$=SOMA(1;1)$$, 'Especiais'),
           ('${empresaA}', $$+55 11 9$$, 'Especiais'),
           ('${empresaA}', $$@usuario$$, 'Especiais'),
           ('${empresaA}', $$-cmd$$, 'Especiais'),
           ('${empresaA}', E'Linha 1\\nLinha 2', 'Especiais')
         RETURNING "id"
       )
       INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id") SELECT '${empresaA}', "id", 1 FROM especiais;`
    );

    // Arquivados: 1 ganho e 2 perdidos (o perdido exige motivo, escolhido do catálogo).
    const motivo = sql(`SELECT "id" FROM "motivos_perda" WHERE "ativo" = true ORDER BY "nome" LIMIT 1`);
    sql(
      `WITH arq AS (
         INSERT INTO "leads" ("empresa_id", "nome", "origem") VALUES
           ('${empresaA}', 'Arquivado Ganho 1', 'Arq'),
           ('${empresaA}', 'Arquivado Perdido 1', 'Arq'),
           ('${empresaA}', 'Arquivado Perdido 2', 'Arq')
         RETURNING "id", "nome"
       )
       INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id", "valor", "motivo_perda_id")
       SELECT '${empresaA}', "id",
              CASE WHEN "nome" LIKE '%Ganho%' THEN 15 ELSE 14 END,
              CASE WHEN "nome" LIKE '%Ganho%' THEN 40000 ELSE NULL END,
              CASE WHEN "nome" LIKE '%Ganho%' THEN NULL ELSE '${motivo}'::uuid END
       FROM arq;`
    );
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  describe('AC-455: exportar a lista baixa um CSV com tudo que atende aos filtros', () => {
    test('traz todos os 60 cards do filtro (mais que uma página), com o cabeçalho e o nome do arquivo @spec:AC-455', async () => {
      const resposta = await exportar(rotaLista, 'lista', amb.cookieA, '?origem=Lote');
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get('content-type')).toContain('text/csv');
      expect(resposta.headers.get('content-disposition')).toMatch(/^attachment; filename="pipeline-lista-\d{4}-\d{2}-\d{2}\.csv"$/);

      const linhas = linhasDe(await resposta.text());
      expect(linhas[0]).toBe(CABECALHO_LISTA);
      expect(linhas).toHaveLength(61);
      expect(linhas.slice(1).every((linha) => linha.startsWith('Lead Lote '))).toBe(true);
    });

    test('cada linha traz telefone, e-mail, origem, etapa, valor com vírgula e as datas formatadas @spec:AC-455', async () => {
      const linhas = linhasDe(await (await exportar(rotaLista, 'lista', amb.cookieA, '?origem=Lote&busca=Lote 001')).text());

      expect(linhas).toHaveLength(2);
      const campos = linhas[1].split(';');
      expect(campos[0]).toBe('Lead Lote 001');
      expect(campos[1]).toBe('(11) 90000-0001');
      expect(campos[2]).toBe('lote1@teste.com');
      expect(campos[3]).toBe('Lote');
      expect(campos[4]).toBe('1º dia de contato');
      expect(campos[5]).toBe('');
      expect(campos[6]).toBe('1500,50');
      expect(campos[8]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    });

    test('os filtros da tela valem: etapa e busca restringem, e ordenar por valor é aceito @spec:AC-455', async () => {
      const daEtapa1 = linhasDe(await (await exportar(rotaLista, 'lista', amb.cookieA, '?etapaId=1&origem=Especiais')).text());
      expect(daEtapa1.length).toBeGreaterThan(1);
      const daEtapa5 = await exportar(rotaLista, 'lista', amb.cookieA, '?etapaId=5&origem=Especiais');
      expect(daEtapa5.status).toBe(422);
      expect((await daEtapa5.json()).codigo).toBe('NADA_PARA_EXPORTAR');

      const ordenada = await exportar(rotaLista, 'lista', amb.cookieA, '?origem=Lote&ordenarPor=valor&ordem=asc');
      expect(ordenada.status).toBe(200);
    });
  });

  describe('AC-456: exportar os arquivados respeita a aba e os filtros', () => {
    test('sem aba traz ganhos e perdidos, com status, consultor, valor, motivo e data de fechamento @spec:AC-456', async () => {
      const resposta = await exportar(rotaArquivados, 'arquivados', amb.cookieA, '?busca=Arquivado');
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get('content-disposition')).toMatch(/pipeline-arquivados-\d{4}-\d{2}-\d{2}\.csv/);

      const linhas = linhasDe(await resposta.text());
      expect(linhas[0]).toBe(CABECALHO_ARQUIVADOS);
      expect(linhas).toHaveLength(4);

      const ganho = linhas.find((linha) => linha.startsWith('Arquivado Ganho 1'))!.split(';');
      expect(ganho[1]).toBe('Ganho');
      expect(ganho[3]).toBe('40000,00');
      expect(ganho[4]).toBe('');
      expect(ganho[5]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

      const perdido = linhas.find((linha) => linha.startsWith('Arquivado Perdido 1'))!.split(';');
      expect(perdido[1]).toBe('Perdido');
      expect(perdido[4]).not.toBe('');
    });

    test('a aba "perdidos" traz só os perdidos, e a de "ganhos" só o ganho @spec:AC-456', async () => {
      const perdidos = linhasDe(await (await exportar(rotaArquivados, 'arquivados', amb.cookieA, '?busca=Arquivado&tipo=perdido')).text());
      expect(perdidos).toHaveLength(3);
      expect(perdidos.slice(1).every((linha) => linha.split(';')[1] === 'Perdido')).toBe(true);

      const ganhos = linhasDe(await (await exportar(rotaArquivados, 'arquivados', amb.cookieA, '?busca=Arquivado&tipo=ganho')).text());
      expect(ganhos).toHaveLength(2);
      expect(ganhos[1].split(';')[1]).toBe('Ganho');
    });

    test('filtro por motivo e por período entram na consulta @spec:AC-456', async () => {
      const motivo = sql(`SELECT "motivo_perda_id" FROM "oportunidades" WHERE "etapa_id" = 14 AND "empresa_id" = '${empresaA}' LIMIT 1`);
      const doMotivo = linhasDe(await (await exportar(rotaArquivados, 'arquivados', amb.cookieA, `?busca=Arquivado&motivoPerdaId=${motivo}`)).text());
      expect(doMotivo).toHaveLength(3);

      const futuro = await exportar(rotaArquivados, 'arquivados', amb.cookieA, '?busca=Arquivado&de=2999-01-01');
      expect(futuro.status).toBe(422);
      expect((await futuro.json()).codigo).toBe('NADA_PARA_EXPORTAR');
    });
  });

  describe('AC-457: só MASTER e GERENTE exportam, e só da própria empresa', () => {
    test('ATENDENTE é 403 e sem sessão é 401, nas duas exportações, sem registrar nada @spec:AC-457', async () => {
      const antes = registros();

      for (const [rota, caminho] of [[rotaLista, 'lista'], [rotaArquivados, 'arquivados']] as const) {
        const atendente = await exportar(rota, caminho, cookieAtendente);
        expect(atendente.status).toBe(403);
        expect((await atendente.json()).codigo).toBe('SEM_PERMISSAO');
        expect((await exportar(rota, caminho, null)).status).toBe(401);
      }

      expect(registros()).toBe(antes);
    });

    test('o arquivo só traz cards da empresa da sessão, mesmo com empresaId na URL @spec:AC-457', async () => {
      sql(
        `WITH l AS (INSERT INTO "leads" ("empresa_id", "nome", "origem") VALUES ('${amb.tenants.empresaB}', 'Lead da Empresa B Exporta', 'Lote') RETURNING "id")
         INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id") SELECT '${amb.tenants.empresaB}', "id", 2 FROM l;`
      );

      const texto = await (await exportar(rotaLista, 'lista', amb.cookieA, `?origem=Lote&empresaId=${amb.tenants.empresaB}`)).text();

      expect(texto).not.toContain('Empresa B Exporta');
      expect(linhasDe(texto)).toHaveLength(61);
    });
  });

  describe('AC-458: o arquivo abre certo no Excel e não executa fórmulas', () => {
    test('começa com BOM, protege campos especiais com aspas e põe apóstrofo antes de fórmulas @spec:AC-458', async () => {
      const resposta = await exportar(rotaLista, 'lista', amb.cookieA, '?origem=Especiais');
      const bytes = new Uint8Array(await resposta.arrayBuffer());
      // `Response.text()` descarta o BOM por especificação; ele é conferido nos bytes (EF BB BF).
      expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      const texto = new TextDecoder().decode(bytes);

      expect(texto).toContain('"Clínica ""Alfa""; Beta"');
      // Tem ponto e vírgula, então além do apóstrofo vai entre aspas.
      expect(texto).toContain("\r\n\"'=SOMA(1;1)\";")
      expect(texto).toMatch(/\r\n'\+55 11 9;/);
      expect(texto).toMatch(/\r\n'@usuario;/);
      expect(texto).toMatch(/\r\n'-cmd;/);
      expect(texto).toContain('"Linha 1\nLinha 2"');
      // Nenhuma célula de nome começa direto com um caractere de fórmula.
      expect(texto).not.toMatch(/\r\n[=+@-]/);
    });
  });

  describe('AC-459: há um teto de linhas e cada exportação fica registrada', () => {
    test('cada arquivo entregue grava quem, quando, a tela, os filtros e a quantidade de linhas @spec:AC-459', async () => {
      const antes = registros();

      await exportar(rotaLista, 'lista', amb.cookieA, '?origem=Lote');
      await exportar(rotaArquivados, 'arquivados', amb.cookieA, '?busca=Arquivado&tipo=perdido');

      expect(registros()).toBe(antes + 2);
      const ultimos = sql(
        `SELECT json_agg(t) FROM (SELECT "tela", "linhas", "filtros", "usuario_id" IS NOT NULL AS tem_usuario, "empresa_id"
                                  FROM "auditoria_exportacoes" ORDER BY "criado_em" DESC LIMIT 2) t`
      );
      const [arquivados, lista] = JSON.parse(ultimos);
      expect(lista).toMatchObject({ tela: 'lista', linhas: 60, filtros: { origem: 'Lote' }, tem_usuario: true, empresa_id: empresaA });
      expect(arquivados).toMatchObject({ tela: 'arquivados', linhas: 2, filtros: { tipo: 'perdido', busca: 'Arquivado' } });
    });

    test('sem nenhum card, a API recusa e nada é registrado @spec:AC-459', async () => {
      const antes = registros();

      const resposta = await exportar(rotaLista, 'lista', amb.cookieA, '?origem=NaoExiste');

      expect(resposta.status).toBe(422);
      expect(registros()).toBe(antes);
    });

    test('o registro é só da empresa da sessão e ninguém consegue alterar ou apagar @spec:AC-459', async () => {
      const comoEmpresa = (empresa: string, comando: string) =>
        sql(`SELECT set_config('app.empresa_id', '${empresa}', false); ${comando}`, 'crm_app').split('\n').pop()!;

      const daPropria = Number(comoEmpresa(empresaA, 'SELECT count(*) FROM "auditoria_exportacoes"'));
      const daOutra = Number(comoEmpresa(amb.tenants.empresaB, 'SELECT count(*) FROM "auditoria_exportacoes"'));
      expect(daPropria).toBeGreaterThan(0);
      expect(daOutra).toBe(0);

      const alterados = Number(comoEmpresa(empresaA, 'WITH u AS (UPDATE "auditoria_exportacoes" SET "linhas" = 0 RETURNING 1) SELECT count(*) FROM u'));
      const apagados = Number(comoEmpresa(empresaA, 'WITH d AS (DELETE FROM "auditoria_exportacoes" RETURNING 1) SELECT count(*) FROM d'));
      expect(alterados).toBe(0);
      expect(apagados).toBe(0);
      expect(Number(comoEmpresa(empresaA, 'SELECT count(*) FROM "auditoria_exportacoes"'))).toBe(daPropria);
    });

    test('acima de 5.000 linhas a API recusa com LIMITE_EXCEDIDO, sem arquivo e sem registro @spec:AC-459', async () => {
      sql(
        `WITH novos AS (
           INSERT INTO "leads" ("empresa_id", "nome", "origem")
           SELECT '${empresaA}', 'Lead Teto ' || g, 'Teto' FROM generate_series(1, 5001) g RETURNING "id"
         )
         INSERT INTO "oportunidades" ("empresa_id", "lead_id", "etapa_id") SELECT '${empresaA}', "id", 1 FROM novos;`
      );
      const antes = registros();

      const resposta = await exportar(rotaLista, 'lista', amb.cookieA, '?origem=Teto');

      expect(resposta.status).toBe(422);
      const corpo = await resposta.json();
      expect(corpo).toMatchObject({ codigo: 'LIMITE_EXCEDIDO', total: 5001, limite: 5000 });
      expect(registros()).toBe(antes);
    });
  });
});

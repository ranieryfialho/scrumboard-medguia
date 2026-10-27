// Testes de T-177 (fase4-pipeline-lote, US-116 e US-117): reatribuir e arquivar
// em lote, e a lista de responsáveis ativos, contra um Postgres 15 efêmero real
// com dois tenants (test/support/api-anexos.ts). Usuários extras (ATENDENTE,
// ativo, inativo e de outra empresa) são criados aqui, pelo mesmo caminho de
// convite que o sistema usa.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { criarAuth } from '../../src/lib/auth/server';
import { convidarUsuario, type AtorConvite } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

const R1 = 'cccccccc-3333-0000-0000-000000000001';
const R2 = 'cccccccc-3333-0000-0000-000000000002';
const R3 = 'cccccccc-3333-0000-0000-000000000003'; // etapa 1 → Perdido
const R4 = 'cccccccc-3333-0000-0000-000000000004'; // levado a Perdido (14) no preparo
const R5 = 'cccccccc-3333-0000-0000-000000000005';
const SENHA = 'senha-correta-123';
const ETAPA_PERDIDO = 14;

interface ResultadoItem {
  id: string;
  ok: boolean;
  codigo?: string;
}

describe('T-177: reatribuir e arquivar em lote (servidor)', () => {
  let amb: AmbienteAnexos;
  let rotaReatribuir: typeof import('../../src/app/api/oportunidades/lote/reatribuir/route');
  let rotaArquivar: typeof import('../../src/app/api/oportunidades/lote/arquivar/route');
  let rotaResponsaveis: typeof import('../../src/app/api/pipeline/responsaveis/route');
  let rotaLinhaDoTempo: typeof import('../../src/app/api/oportunidades/[id]/linha-do-tempo/route');
  let cookieAtendente: string;
  let idAtendente: string;
  let idInativo: string;
  let idDeOutraEmpresa: string;
  let idMotivo: string;

  function post(rota: { POST: (r: NextRequest) => Promise<Response> }, caminho: string, cookie: string | null, corpo: unknown) {
    return rota.POST(
      new NextRequest(`http://localhost/api/oportunidades/lote/${caminho}`, {
        method: 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      })
    );
  }

  function sql(comando: string): string {
    const resultado = amb.pg.psqlComo('crm_migrator', comando);
    if (resultado.status !== 0) throw new Error(`Falha no SQL de preparo: ${resultado.stderr}`);
    return resultado.stdout.trim();
  }

  const responsavelDe = (cardId: string) => sql(`SELECT coalesce("responsavel_id"::text, '') FROM "oportunidades" WHERE "id" = '${cardId}'`);
  const etapaDe = (cardId: string) => Number(sql(`SELECT "etapa_id" FROM "oportunidades" WHERE "id" = '${cardId}'`));
  const eventosDeReatribuicao = (cardId: string) =>
    Number(sql(`SELECT count(*) FROM "oportunidade_eventos" WHERE "oportunidade_id" = '${cardId}' AND "tipo" = 'reatribuicao'`));

  async function criarUsuario(papel: 'ATENDENTE' | 'GERENTE', empresaId: string, email: string): Promise<{ id: string; cookie: string }> {
    const ator: AtorConvite = { usuarioId: 'ffffffff-0000-0000-0000-0000000000f9', empresaId, papel: 'MASTER', isSuperAdmin: false };
    const convite = await convidarUsuario(amb.db, ator, { email, papel });
    await definirSenhaComToken(amb.db, convite.token, SENHA);
    const id = sql(`SELECT "id" FROM "usuarios" WHERE "email" = '${email}'`);
    const resposta = await criarAuth(amb.db).api.signInEmail({ body: { email, password: SENHA }, asResponse: true });
    const sessionCookie = (resposta.headers.getSetCookie?.() ?? []).find((c) => c.includes('better-auth.session_token='));
    return { id, cookie: sessionCookie ? sessionCookie.split(';')[0] : '' };
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos([
      { id: R1, etapaId: 1 },
      { id: R2, etapaId: 1 },
      { id: R3, etapaId: 1 },
      { id: R4, etapaId: 1 },
      { id: R5, etapaId: 1 },
    ]);
    rotaReatribuir = await import('../../src/app/api/oportunidades/lote/reatribuir/route');
    rotaArquivar = await import('../../src/app/api/oportunidades/lote/arquivar/route');
    rotaResponsaveis = await import('../../src/app/api/pipeline/responsaveis/route');
    rotaLinhaDoTempo = await import('../../src/app/api/oportunidades/[id]/linha-do-tempo/route');

    const atendente = await criarUsuario('ATENDENTE', amb.tenants.empresaA, 'atendente.lote@teste.com');
    idAtendente = atendente.id;
    cookieAtendente = atendente.cookie;
    idInativo = (await criarUsuario('ATENDENTE', amb.tenants.empresaA, 'inativo.lote@teste.com')).id;
    sql(`UPDATE "empresas_usuarios" SET "ativo" = false WHERE "usuario_id" = '${idInativo}'`);
    idDeOutraEmpresa = (await criarUsuario('ATENDENTE', amb.tenants.empresaB, 'outra.empresa.lote@teste.com')).id;
    idMotivo = sql(`SELECT "id" FROM "motivos_perda" WHERE "ativo" = true ORDER BY "nome" LIMIT 1`);
    // R4 já está em "Perdido" (a regra do banco exige o motivo junto).
    sql(`UPDATE "oportunidades" SET "etapa_id" = ${ETAPA_PERDIDO}, "motivo_perda_id" = '${idMotivo}' WHERE "id" = '${R4}'`);
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  describe('AC-450: reatribuir muda o responsável de todos os selecionados', () => {
    test('GERENTE passa os cards para uma pessoa ativa e o resultado diz quantos @spec:AC-450', async () => {
      const resposta = await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R1, R2], responsavelId: idAtendente });
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();

      expect(corpo.aplicados).toBe(2);
      expect(corpo.falhas).toBe(0);
      expect(responsavelDe(R1)).toBe(idAtendente);
      expect(responsavelDe(R2)).toBe(idAtendente);
    });

    test('o mesmo responsável de novo conta como feito, sem gravar outro evento @spec:AC-450', async () => {
      const antes = eventosDeReatribuicao(R1);
      const corpo = await (await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R1], responsavelId: idAtendente })).json();

      expect(corpo.resultados[0]).toEqual({ id: R1, ok: true });
      expect(eventosDeReatribuicao(R1)).toBe(antes);
    });
  });

  describe('AC-451: só MASTER e GERENTE reatribuem, e só para gente ativa da própria empresa', () => {
    test('ATENDENTE é 403 e nada muda; sem sessão é 401 @spec:AC-451', async () => {
      const antes = responsavelDe(R5);

      const resposta = await post(rotaReatribuir, 'reatribuir', cookieAtendente, { ids: [R5], responsavelId: idAtendente });
      expect(resposta.status).toBe(403);
      expect((await resposta.json()).codigo).toBe('SEM_PERMISSAO');
      expect(responsavelDe(R5)).toBe(antes);

      expect((await post(rotaReatribuir, 'reatribuir', null, { ids: [R5], responsavelId: idAtendente })).status).toBe(401);
    });

    test.each([
      ['de outra empresa', () => idDeOutraEmpresa],
      ['inativo', () => idInativo],
      ['inexistente', () => 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
      ['que nem é uuid', () => 'nao-e-uuid'],
    ])('responsável %s é 400 RESPONSAVEL_INVALIDO e nenhum card é alterado @spec:AC-451', async (_nome, obter) => {
      const antes = responsavelDe(R5);

      const resposta = await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R5], responsavelId: obter() });

      expect(resposta.status).toBe(400);
      expect((await resposta.json()).codigo).toBe('RESPONSAVEL_INVALIDO');
      expect(responsavelDe(R5)).toBe(antes);
    });

    test('card de outra empresa volta "não encontrado" sem ser alterado; pedido inválido é 400 @spec:AC-448', async () => {
      const outra = amb.tenants.oportunidadeB;
      const antes = responsavelDe(outra);

      const corpo = await (await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [outra], responsavelId: idAtendente })).json();

      expect(corpo.resultados[0]).toEqual({ id: outra, ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
      expect(responsavelDe(outra)).toBe(antes);
      expect((await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [], responsavelId: idAtendente })).status).toBe(400);
      expect((await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R5] })).status).toBe(400);
    });
  });

  describe('AC-452: cada reatribuição fica no histórico do card', () => {
    test('a linha do tempo mostra o evento com quem estava, quem ficou e quem fez @spec:AC-452', async () => {
      await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R3], responsavelId: idAtendente });
      expect(eventosDeReatribuicao(R3)).toBe(1);

      const resposta = await rotaLinhaDoTempo.GET(
        new NextRequest(`http://localhost/api/oportunidades/${R3}/linha-do-tempo`, { headers: { Cookie: amb.cookieA } }),
        { params: Promise.resolve({ id: R3 }) }
      );
      const corpo = await resposta.json();
      const evento = corpo.itens.find((item: { tipo: string }) => item.tipo === 'reatribuicao');

      expect(evento).toBeTruthy();
      expect(evento.texto).toMatch(/Responsável definido: ".+"/);
      expect(evento.autorNome).toBeTruthy();

      // Reatribuir de novo mostra "de X para Y".
      await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R3], responsavelId: idAtendente });
      const gerenteId = sql(`SELECT "id" FROM "usuarios" WHERE "email" = 'gerente.a@teste.com'`);
      await post(rotaReatribuir, 'reatribuir', amb.cookieA, { ids: [R3], responsavelId: gerenteId });
      const depois = await (
        await rotaLinhaDoTempo.GET(
          new NextRequest(`http://localhost/api/oportunidades/${R3}/linha-do-tempo`, { headers: { Cookie: amb.cookieA } }),
          { params: Promise.resolve({ id: R3 }) }
        )
      ).json();
      expect(depois.itens.some((item: { texto: string }) => /Responsável alterado: de ".+" para ".+"/.test(item.texto))).toBe(true);
    });
  });

  describe('AC-453: arquivar leva os selecionados para "Perdido" com o motivo escolhido', () => {
    test('os que podem vão para Perdido com o motivo; o que já estava lá falha com o código do domínio @spec:AC-453', async () => {
      const resposta = await post(rotaArquivar, 'arquivar', amb.cookieA, { ids: [R3, R4], motivoPerdaId: idMotivo });
      expect(resposta.status).toBe(200);
      const corpo = await resposta.json();

      expect(corpo.aplicados).toBe(1);
      expect(corpo.falhas).toBe(1);
      const porId = new Map<string, ResultadoItem>(corpo.resultados.map((r: ResultadoItem) => [r.id, r]));
      expect(porId.get(R3)?.ok).toBe(true);
      expect(porId.get(R4)?.ok).toBe(false);

      expect(etapaDe(R3)).toBe(ETAPA_PERDIDO);
      expect(sql(`SELECT "motivo_perda_id" FROM "oportunidades" WHERE "id" = '${R3}'`)).toBe(idMotivo);
    });
  });

  describe('AC-454: arquivar exige o motivo', () => {
    test('sem motivo é 400 MOTIVO_OBRIGATORIO; motivo que não existe é 400 MOTIVO_INVALIDO; nada é alterado @spec:AC-454', async () => {
      const antes = etapaDe(R5);

      const semMotivo = await post(rotaArquivar, 'arquivar', amb.cookieA, { ids: [R5] });
      expect(semMotivo.status).toBe(400);
      expect((await semMotivo.json()).codigo).toBe('MOTIVO_OBRIGATORIO');

      const vazio = await post(rotaArquivar, 'arquivar', amb.cookieA, { ids: [R5], motivoPerdaId: '  ' });
      expect((await vazio.json()).codigo).toBe('MOTIVO_OBRIGATORIO');

      const invalido = await post(rotaArquivar, 'arquivar', amb.cookieA, { ids: [R5], motivoPerdaId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
      expect(invalido.status).toBe(400);
      expect((await invalido.json()).codigo).toBe('MOTIVO_INVALIDO');

      expect(etapaDe(R5)).toBe(antes);
    });

    test('lista inválida é 400 e sem sessão é 401; card de outra empresa volta "não encontrado" @spec:AC-448', async () => {
      expect((await post(rotaArquivar, 'arquivar', amb.cookieA, { ids: [], motivoPerdaId: idMotivo })).status).toBe(400);
      expect((await post(rotaArquivar, 'arquivar', null, { ids: [R5], motivoPerdaId: idMotivo })).status).toBe(401);

      const outra = amb.tenants.oportunidadeB;
      const corpo = await (await post(rotaArquivar, 'arquivar', amb.cookieA, { ids: [outra], motivoPerdaId: idMotivo })).json();
      expect(corpo.resultados[0]).toEqual({ id: outra, ok: false, codigo: 'OPORTUNIDADE_NAO_ENCONTRADA' });
      expect(etapaDe(outra)).not.toBe(ETAPA_PERDIDO);
    });
  });

  describe('lista de responsáveis ativos (seletor de "Reatribuir Comercial")', () => {
    test('traz só usuários ativos da empresa da sessão, e 401 sem sessão @spec:AC-450', async () => {
      const resposta = await rotaResponsaveis.GET(new NextRequest('http://localhost/api/pipeline/responsaveis', { headers: { Cookie: amb.cookieA } }));
      expect(resposta.status).toBe(200);
      const ids = (await resposta.json()).responsaveis.map((r: { id: string }) => r.id);

      expect(ids).toContain(idAtendente);
      expect(ids).not.toContain(idInativo);
      expect(ids).not.toContain(idDeOutraEmpresa);

      expect((await rotaResponsaveis.GET(new NextRequest('http://localhost/api/pipeline/responsaveis'))).status).toBe(401);
    });
  });
});

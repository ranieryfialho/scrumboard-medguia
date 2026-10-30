// T-263 (fase5-email-config, US-169): a configuração de e-mail por empresa contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';
import { lerConfiguracaoDeEmail } from '../../src/repositories/email-config';

const SEGREDO = 'segredo-de-teste-para-configuracoes-1234567890';
const CHAVE_A = 're_AAAAAAAAAAAAAAAAAAAAAAAAAAAA1111';
const CHAVE_B = 're_BBBBBBBBBBBBBBBBBBBBBBBBBBBB2222';

describe('T-263: API de configuração de e-mail', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/configuracoes/email/route');
  let gerente: string;
  let gerenteB: string;
  let atendente: string;
  const segredoOriginal = process.env.SEGREDO_CONFIGURACOES;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const req = (cookie: string | null, metodo = 'GET', corpo?: unknown) =>
    new NextRequest('http://localhost/api/configuracoes/email', {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  const ler = (cookie: string | null = gerente) => rota.GET(req(cookie));
  const gravar = (corpo: unknown, cookie: string | null = gerente) => rota.PUT(req(cookie, 'PUT', corpo));

  beforeAll(async () => {
    process.env.SEGREDO_CONFIGURACOES = SEGREDO;
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.f695@teste.com', 'GERENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.f695@teste.com', 'GERENTE', amb.tenants.empresaB);
    atendente = await cookieDePapel(amb, 'atendente.f695@teste.com', 'ATENDENTE');
    rota = await import('../../src/app/api/configuracoes/email/route');
  }, 180_000);
  afterAll(async () => {
    if (segredoOriginal === undefined) delete process.env.SEGREDO_CONFIGURACOES;
    else process.env.SEGREDO_CONFIGURACOES = segredoOriginal;
    await amb?.parar();
  });

  test('a API nunca devolve a chave: só se há chave e os 4 últimos caracteres; valida chave e remetente @spec:AC-695', async () => {
    expect(await (await ler()).json()).toEqual({ chaveConfigurada: false, chaveFinal: null, remetente: null, descadastrados: 0 });
    const r = await gravar({ chave: CHAVE_A, remetente: 'Clínica A <contato@clinica-a.com.br>' });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toEqual({ chaveConfigurada: true, chaveFinal: '1111', remetente: 'Clínica A <contato@clinica-a.com.br>', descadastrados: 0 });
    expect(JSON.stringify(corpo)).not.toContain('AAAAAAAA');
    expect(JSON.stringify(await (await ler()).json())).not.toContain(CHAVE_A);

    for (const [mudanca, campo] of [
      [{ chave: 'abc' }, 'chave'],
      [{ chave: 'sk_AAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, 'chave'],
      [{ chave: 're_com espaco aaaaaaaaaaaaaaaaaaa' }, 'chave'],
      [{ chave: `re_${'a'.repeat(250)}` }, 'chave'],
      [{ chave: 123 }, 'chave'],
      [{ remetente: 'sem-arroba' }, 'remetente'],
      [{ remetente: 'Nome <invalido>' }, 'remetente'],
      [{ remetente: `${'a'.repeat(200)}@x.com` }, 'remetente'],
    ] as Array<[Record<string, unknown>, string]>) {
      const e = await gravar(mudanca);
      expect(e.status, JSON.stringify(mudanca)).toBe(400);
      expect((await e.json()).campo).toBe(campo);
    }
    expect((await gravar({})).status).toBe(400);
    expect((await gravar({ chave: CHAVE_B }, atendente)).status).toBe(403);
    expect((await ler(atendente)).status).toBe(403);
    expect((await ler(null)).status).toBe(401);
    // omitir a chave mantém a atual; só o remetente muda
    expect(await (await gravar({ remetente: 'contato@clinica-a.com.br' })).json()).toEqual({ chaveConfigurada: true, chaveFinal: '1111', remetente: 'contato@clinica-a.com.br', descadastrados: 0 });
  });

  test('a chave fica cifrada no banco e só o worker a decifra; sem o segredo, salvar dá 503 e nada é gravado @spec:AC-696', async () => {
    const guardado = sql(`SELECT valor #>> '{}' FROM empresa_configuracoes WHERE empresa_id = '${amb.tenants.empresaA}' AND chave = 'resend_api_key'`);
    expect(guardado.startsWith('v1:')).toBe(true);
    expect(guardado).not.toContain(CHAVE_A);
    expect(guardado).not.toContain('AAAAAAAA');
    expect(await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaA)).toEqual({ apiKey: CHAVE_A, remetente: 'contato@clinica-a.com.br' });
    expect(await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaA, 'outro-segredo-qualquer-com-32-caracteres!!')).toBeNull();
    expect(await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaA, null)).toBeNull();

    delete process.env.SEGREDO_CONFIGURACOES;
    const indisponivel = await gravar({ chave: CHAVE_B });
    expect(indisponivel.status).toBe(503);
    expect((await indisponivel.json()).codigo).toBe('CONFIGURACAO_INDISPONIVEL');
    expect(sql(`SELECT valor #>> '{}' FROM empresa_configuracoes WHERE empresa_id = '${amb.tenants.empresaA}' AND chave = 'resend_api_key_final'`)).toBe('f:1111'); // nada mudou
    expect((await gravar({ remetente: 'outro@clinica-a.com.br' })).status).toBe(200); // o remetente não depende do segredo
    process.env.SEGREDO_CONFIGURACOES = SEGREDO;
  });

  test('cada empresa tem a sua; trocar ou remover a da A não mexe na da B @spec:AC-697', async () => {
    await gravar({ chave: CHAVE_B, remetente: 'b@clinica-b.com' }, gerenteB);
    expect(await (await ler(gerenteB)).json()).toEqual({ chaveConfigurada: true, chaveFinal: '2222', remetente: 'b@clinica-b.com', descadastrados: 0 });
    expect((await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaB))?.apiKey).toBe(CHAVE_B);
    expect((await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaA))?.apiKey).toBe(CHAVE_A);

    const removida = await gravar({ chave: null });
    expect(await removida.json()).toMatchObject({ chaveConfigurada: false, chaveFinal: null });
    expect(await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaA)).toBeNull();
    expect((await lerConfiguracaoDeEmail(amb.db, amb.tenants.empresaB))?.apiKey).toBe(CHAVE_B);
    expect(await (await ler(gerenteB)).json()).toMatchObject({ chaveConfigurada: true, chaveFinal: '2222' });
  });
});

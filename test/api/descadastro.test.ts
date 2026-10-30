// T-274 (fase5-email-descadastro, US-174): a rota pública do descadastro e a lista por empresa, contra um Postgres efêmero
// real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';
import { gerarTokenDeDescadastro } from '../../src/lib/email/descadastro-token';
import { contarDescadastrados, estaDescadastrado } from '../../src/repositories/email-descadastros';

const SEGREDO = 'segredo-de-teste-do-descadastro-com-32-caracteres+';

describe('T-274: descadastro (rota pública e lista por empresa)', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/descadastro/[token]/route');
  let rotaEmail: typeof import('../../src/app/api/configuracoes/email/route');
  let gerente: string;
  const segredoOriginal = process.env.SEGREDO_CONFIGURACOES;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const get = (token: string) => rota.GET(new NextRequest(`http://localhost/api/descadastro/${token}`), { params: Promise.resolve({ token }) });
  const post = (token: string, corpo?: string) =>
    rota.POST(
      new NextRequest(`http://localhost/api/descadastro/${token}`, { method: 'POST', headers: corpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, body: corpo }),
      { params: Promise.resolve({ token }) }
    );
  const tokenDe = (empresaId: string, email: string) => gerarTokenDeDescadastro(empresaId, email, SEGREDO);
  const naLista = (empresaId: string) => sql(`SELECT string_agg(email, ',' ORDER BY email) FROM email_descadastros WHERE empresa_id = '${empresaId}'`);

  beforeAll(async () => {
    process.env.SEGREDO_CONFIGURACOES = SEGREDO;
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.f716@teste.com', 'GERENTE');
    rota = await import('../../src/app/api/descadastro/[token]/route');
    rotaEmail = await import('../../src/app/api/configuracoes/email/route');
  }, 180_000);
  afterAll(async () => {
    if (segredoOriginal === undefined) delete process.env.SEGREDO_CONFIGURACOES;
    else process.env.SEGREDO_CONFIGURACOES = segredoOriginal;
    await amb?.parar();
  });

  test('o GET só informa a empresa e o e-mail mascarado e NÃO descadastra; link inválido dá 404 sem revelar nada @spec:AC-715', async () => {
    const { empresaA } = amb.tenants;
    const r = await get(tokenDe(empresaA, 'Maria@Clinica.com'));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toEqual({ empresaNome: 'Empresa A', emailMascarado: 'm***@clinica.com' });
    expect(JSON.stringify(corpo)).not.toContain('maria@clinica.com');
    expect(naLista(empresaA)).toBe('');

    const invalido = await get('abc.def');
    expect(invalido.status).toBe(404);
    expect(await invalido.json()).toEqual({ codigo: 'LINK_INVALIDO' });
    // token válido de uma empresa que não existe também é "inválido"
    expect((await get(tokenDe('99999999-9999-4999-8999-999999999999', 'x@y.com'))).status).toBe(404);
  });

  test('o POST descadastra; repetir é inofensivo e o e-mail fica uma vez só, em qualquer caixa @spec:AC-715 @spec:AC-717', async () => {
    const { empresaA } = amb.tenants;
    const r = await post(tokenDe(empresaA, 'Maria@Clinica.com'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, empresaNome: 'Empresa A' });
    expect((await post(tokenDe(empresaA, 'maria@clinica.com'))).status).toBe(200);
    expect((await post(tokenDe(empresaA, 'MARIA@CLINICA.COM'))).status).toBe(200);
    expect(naLista(empresaA)).toBe('maria@clinica.com');
    expect(sql(`SELECT count(*) FROM email_descadastros WHERE empresa_id = '${empresaA}'`)).toBe('1');
  });

  test('o clique único do cliente de e-mail (corpo List-Unsubscribe=One-Click) descadastra sem tela; token ruim dá 400 sem gravar @spec:AC-716', async () => {
    const { empresaA } = amb.tenants;
    const r = await post(tokenDe(empresaA, 'um.clique@clinica.com'), 'List-Unsubscribe=One-Click');
    expect(r.status).toBe(200);
    expect(naLista(empresaA)).toContain('um.clique@clinica.com');

    const antes = sql('SELECT count(*) FROM email_descadastros');
    for (const ruim of ['abc.def', '', `${tokenDe(empresaA, 'x@y.com')}x`]) {
      const e = await post(ruim);
      expect(e.status, ruim).toBe(400);
      expect(await e.json()).toEqual({ codigo: 'LINK_INVALIDO' });
    }
    expect(sql('SELECT count(*) FROM email_descadastros')).toBe(antes);
  });

  test('o descadastro vale só para a empresa do token: a outra continua podendo enviar e ninguém vê a lista alheia @spec:AC-717', async () => {
    const { empresaA, empresaB } = amb.tenants;
    expect(await estaDescadastrado(amb.db, empresaA, 'maria@clinica.com')).toBe(true);
    expect(await estaDescadastrado(amb.db, empresaB, 'maria@clinica.com')).toBe(false);
    await post(tokenDe(empresaB, 'so.da.b@clinica.com'));
    expect(naLista(empresaB)).toBe('so.da.b@clinica.com');
    expect(await contarDescadastrados(amb.db, { empresaId: empresaA })).toBe(2);
    expect(await contarDescadastrados(amb.db, { empresaId: empresaB })).toBe(1);
    // sob o contexto da A, o RLS não enxerga a linha da B (leitura direta pela tabela)
    expect(await estaDescadastrado(amb.db, empresaA, 'so.da.b@clinica.com')).toBe(false);
  });

  test('a tela de e-mail da empresa mostra só a contagem de descadastrados e não oferece recadastrar @spec:AC-719', async () => {
    const r = await rotaEmail.GET(new NextRequest('http://localhost/api/configuracoes/email', { headers: { Cookie: gerente } }));
    const corpo = await r.json();
    expect(corpo.descadastrados).toBe(2); // a empresa A do gerente: maria e um.clique
    expect(Object.keys(corpo).sort()).toEqual(['chaveConfigurada', 'chaveFinal', 'descadastrados', 'remetente']);
    const delecao = await rotaEmail.PUT(new NextRequest('http://localhost/api/configuracoes/email', { method: 'PUT', headers: { Cookie: gerente, 'content-type': 'application/json' }, body: JSON.stringify({ descadastrados: 0 }) }));
    expect(delecao.status).toBe(400); // nada de lista nem de recadastro por aqui
    expect(sql(`SELECT count(*) FROM email_descadastros WHERE empresa_id = '${amb.tenants.empresaA}'`)).toBe('2');
  });
});

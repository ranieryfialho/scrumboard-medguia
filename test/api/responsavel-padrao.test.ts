// Responsável padrão dos cards novos (migration 0036), contra um Postgres efêmero real com dois tenants: o gatilho do banco aplica o padrão em
// todo card que nasce sem responsável, e a rota de Equipe escolhe, limpa e leva o padrão aos cards que já estão sem responsável.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

describe('Responsável padrão dos cards', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/equipe/responsavel-padrao/route');
  let gerente: string;
  let atendente: string;
  let gerenteId: string;
  let atendenteId: string;

  function sql(texto: string): string {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const chamar = (metodo: 'GET' | 'PUT' | 'POST', cookie: string | null, corpo?: unknown) =>
    rota[metodo](
      new NextRequest('http://localhost/api/equipe/responsavel-padrao', {
        method: metodo,
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      })
    );
  const novoCard = (leadId: string, responsavel: string | null = null): string =>
    sql(`INSERT INTO oportunidades (empresa_id, lead_id, etapa_id, responsavel_id) VALUES ('${amb.tenants.empresaA}', '${leadId}', 1, ${responsavel ? `'${responsavel}'` : 'NULL'}) RETURNING coalesce(responsavel_id::text, 'NULO')`).split('\n')[0];

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    gerente = await cookieDePapel(amb, 'gerente.padrao@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.padrao@teste.com', 'ATENDENTE');
    gerenteId = sql(`SELECT id FROM usuarios WHERE email = 'gerente.padrao@teste.com'`);
    atendenteId = sql(`SELECT id FROM usuarios WHERE email = 'atendente.padrao@teste.com'`);
    rota = await import('../../src/app/api/equipe/responsavel-padrao/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('só gerente e master mexem no responsável padrão; sem sessão dá 401 @spec:AC-780', async () => {
    expect((await chamar('GET', null)).status).toBe(401);
    expect((await chamar('GET', atendente)).status).toBe(403);
    expect((await chamar('PUT', atendente, { responsavelId: atendenteId })).status).toBe(403);
    expect((await chamar('POST', atendente, { aplicar: true })).status).toBe(403);
  });

  test('sem padrão o card nasce sem responsável; com padrão o banco aplica; o explícito vence; padrão inativo vira sem responsável @spec:AC-780', async () => {
    const lead = amb.tenants.leadA;
    expect(novoCard(lead)).toBe('NULO');

    const salvou = await chamar('PUT', gerente, { responsavelId: gerenteId });
    expect(salvou.status).toBe(200);
    expect((await salvou.json()).responsavelId).toBe(gerenteId);
    expect(novoCard(lead)).toBe(gerenteId);
    // quem informa um responsável continua valendo
    expect(novoCard(lead, atendenteId)).toBe(atendenteId);

    // o escolhido saiu da empresa: o card nasce sem responsável, como antes
    sql(`UPDATE empresas_usuarios SET ativo = false WHERE usuario_id = '${gerenteId}' AND empresa_id = '${amb.tenants.empresaA}'`);
    expect(novoCard(lead)).toBe('NULO');
    sql(`UPDATE empresas_usuarios SET ativo = true WHERE usuario_id = '${gerenteId}' AND empresa_id = '${amb.tenants.empresaA}'`);
  });

  test('recusa quem não é membro ativo da empresa (422) e id inválido (400); null limpa @spec:AC-780', async () => {
    expect((await chamar('PUT', gerente, { responsavelId: 'nao-e-uuid' })).status).toBe(400);
    expect((await chamar('PUT', gerente, { responsavelId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    const limpou = await chamar('PUT', gerente, { responsavelId: null });
    expect(limpou.status).toBe(200);
    expect((await limpou.json()).responsavelId).toBeNull();
    expect(novoCard(amb.tenants.leadA)).toBe('NULO');
  });

  test('aplicar leva o padrão aos cards sem responsável, com um evento em cada um, e não mexe nos que já têm dono @spec:AC-780', async () => {
    // sem padrão escolhido não há o que aplicar
    expect((await chamar('POST', gerente, { aplicar: true })).status).toBe(409);

    await chamar('PUT', gerente, { responsavelId: gerenteId });
    sql(`UPDATE oportunidades SET responsavel_id = NULL WHERE empresa_id = '${amb.tenants.empresaA}' AND id IN (SELECT id FROM oportunidades WHERE empresa_id = '${amb.tenants.empresaA}' ORDER BY id LIMIT 2)`);
    const antes = Number(sql(`SELECT count(*) FROM oportunidades WHERE empresa_id = '${amb.tenants.empresaA}' AND responsavel_id IS NULL`));
    const donoAntes = sql(`SELECT count(*) FROM oportunidades WHERE empresa_id = '${amb.tenants.empresaA}' AND responsavel_id = '${atendenteId}'`);
    expect(antes).toBeGreaterThanOrEqual(2);

    const r = await chamar('POST', gerente, { aplicar: true });
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ aplicados: antes, falhas: 0, semResponsavel: 0 });
    expect(sql(`SELECT count(*) FROM oportunidades WHERE empresa_id = '${amb.tenants.empresaA}' AND responsavel_id IS NULL`)).toBe('0');
    expect(sql(`SELECT count(*) FROM oportunidades WHERE empresa_id = '${amb.tenants.empresaA}' AND responsavel_id = '${atendenteId}'`)).toBe(donoAntes);
    expect(Number(sql(`SELECT count(*) FROM oportunidade_eventos WHERE empresa_id = '${amb.tenants.empresaA}' AND tipo = 'reatribuicao' AND payload->>'para' = '${gerenteId}'`))).toBeGreaterThanOrEqual(antes);
  });
});

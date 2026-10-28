// T-210 (fase4-admin, US-138): POST /api/equipe/convites e o e-mail de convite, contra um
// Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';
import { enviarEmailConvite } from '../../src/lib/email/enviar';
import { templateConvite } from '../../src/lib/email/templates';

const ANA = 'b0b0b0b0-3020-0000-0000-0000000000a1';
const CAIO = 'b0b0b0b0-3020-0000-0000-0000000000a3';

describe('T-210: convite de usuário', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/equipe/convites/route');
  let rotaLista: typeof import('../../src/app/api/equipe/route');
  let master: string;
  let gerente: string;
  let atendente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const convidar = (corpo: unknown, cookie: string | null = master) =>
    rota.POST(new NextRequest('http://localhost/api/equipe/convites', { method: 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA } = amb.tenants;
    master = await cookieDePapel(amb, 'master.f210@teste.com', 'MASTER');
    gerente = await cookieDePapel(amb, 'gerente.f210@teste.com', 'GERENTE');
    atendente = await cookieDePapel(amb, 'atendente.f210@teste.com', 'ATENDENTE');
    sql(`INSERT INTO usuarios (id, email, nome) VALUES ('${ANA}', 'ana@f210.com', 'Ana Ativa'), ('${CAIO}', 'caio@f210.com', 'Caio Desativado');
         INSERT INTO empresas_usuarios (empresa_id, usuario_id, papel, ativo) VALUES ('${empresaA}', '${ANA}', 'ATENDENTE', true), ('${empresaA}', '${CAIO}', 'ATENDENTE', false);
         INSERT INTO contas (usuario_id, id_conta, id_provedor, senha) VALUES ('${ANA}', '${ANA}', 'credential', 'x'), ('${CAIO}', '${CAIO}', 'credential', 'x');`);
    rota = await import('../../src/app/api/equipe/convites/route');
    rotaLista = await import('../../src/app/api/equipe/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('cria o vínculo na empresa da sessão, grava o nome, gera o token de 24 h e devolve o link @spec:AC-587', async () => {
    const r = await convidar({ email: ' Nova.Pessoa@F210.com ', nome: 'Dra. Nova', papel: 'GERENTE', empresaId: amb.tenants.empresaB });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ papel: 'GERENTE', reativado: false, emailEnviado: false });
    expect(corpo.linkConvite).toMatch(/\/convite\/[0-9a-f]{64}$/);
    const duracao = new Date(corpo.expiraEm).getTime() - Date.now();
    expect(duracao).toBeGreaterThan(23 * 3600_000);
    expect(duracao).toBeLessThanOrEqual(24 * 3600_000);

    expect(sql(`SELECT nome FROM usuarios WHERE email = 'nova.pessoa@f210.com'`)).toBe('Dra. Nova');
    // a empresa vem da sessão, nunca do corpo
    expect(sql(`SELECT empresa_id FROM empresas_usuarios WHERE usuario_id = '${corpo.usuarioId}'`)).toBe(amb.tenants.empresaA);
    expect(sql(`SELECT count(*) FROM tokens_verificacao WHERE identificador = 'convite:nova.pessoa@f210.com'`)).toBe('1');

    // o token vira a senha e a pessoa passa de "pendente" a "ativa"
    const token = corpo.linkConvite.split('/convite/')[1];
    const antes = (await (await rotaLista.GET(new NextRequest('http://localhost/api/equipe?busca=nova.pessoa', { headers: { Cookie: master } }))).json()).colaboradores[0];
    expect(antes.status).toBe('pendente');
    await definirSenhaComToken(amb.db, token, 'SenhaForte@2026');
    const depois = (await (await rotaLista.GET(new NextRequest('http://localhost/api/equipe?busca=nova.pessoa', { headers: { Cookie: master } }))).json()).colaboradores[0];
    expect(depois.status).toBe('ativo');

    // o e-mail marcado MedCRM leva o link e o prazo
    const enviados: { destinatario: string; assunto: string; html: string }[] = [];
    await enviarEmailConvite('x@y.com', 'abc123', { baseUrl: 'https://crm.teste', convidadoPor: 'Roberto', transporte: { enviar: async (e) => void enviados.push(e) } });
    expect(enviados[0].assunto).toBe('MedCRM — Convite para entrar na equipe');
    expect(enviados[0].html).toContain('https://crm.teste/convite/abc123');
    expect(enviados[0].html).toContain('Roberto convidou você');
    expect(templateConvite('t', { baseUrl: 'https://a' }).texto).toContain('expira em 24 horas');
  });

  test('o gerente só convida atendente e as recusas não criam nada @spec:AC-588', async () => {
    const antes = sql('SELECT count(*) FROM empresas_usuarios');
    expect((await convidar({ email: 'g2@f210.com', nome: 'G2', papel: 'GERENTE' }, gerente)).status).toBe(403);
    expect((await convidar({ email: 'm2@f210.com', nome: 'M2', papel: 'MASTER' }, gerente)).status).toBe(403);
    const ok = await convidar({ email: 'a2@f210.com', nome: 'A2', papel: 'ATENDENTE' }, gerente);
    expect(ok.status).toBe(201);

    const antesDasRecusas = sql('SELECT count(*) FROM empresas_usuarios');
    const tokensAntes = sql('SELECT count(*) FROM tokens_verificacao');
    expect((await convidar({ email: 'sem-arroba', nome: 'X', papel: 'ATENDENTE' })).status).toBe(400);
    expect((await convidar({ email: 'ok@f210.com', nome: '  ', papel: 'ATENDENTE' })).status).toBe(400);
    expect((await convidar({ email: 'ok@f210.com', nome: 'X', papel: 'DONO' })).status).toBe(400);
    expect((await convidar(null)).status).toBe(400);
    const duplicada = await convidar({ email: 'ana@f210.com', nome: 'Ana', papel: 'ATENDENTE' });
    expect(duplicada.status).toBe(409);
    expect((await duplicada.json()).codigo).toBe('JA_E_COLABORADOR');
    expect((await convidar({ email: 'a2@f210.com', nome: 'A2', papel: 'ATENDENTE' })).status).toBe(409); // ainda pendente
    expect(sql('SELECT count(*) FROM empresas_usuarios')).toBe(antesDasRecusas);
    expect(sql('SELECT count(*) FROM tokens_verificacao')).toBe(tokensAntes);
    expect(Number(antesDasRecusas)).toBe(Number(antes) + 1);

    expect((await convidar({ email: 'z@f210.com', nome: 'Z', papel: 'ATENDENTE' }, null)).status).toBe(401);
    expect((await convidar({ email: 'z@f210.com', nome: 'Z', papel: 'ATENDENTE' }, atendente)).status).toBe(403);
  });

  test('convidar quem está desativado na empresa reativa o vínculo em vez de duplicar @spec:AC-588', async () => {
    const r = await convidar({ email: 'caio@f210.com', nome: 'Caio', papel: 'GERENTE' });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ reativado: true, emailEnviado: false, linkConvite: null, papel: 'GERENTE' });
    expect(sql(`SELECT count(*) FROM empresas_usuarios WHERE usuario_id = '${CAIO}'`)).toBe('1');
    expect(sql(`SELECT ativo || ' ' || papel FROM empresas_usuarios WHERE usuario_id = '${CAIO}'`)).toBe('true GERENTE');
  });
});

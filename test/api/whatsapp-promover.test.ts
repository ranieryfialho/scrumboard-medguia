// T-234 (fase5-acoes-rapidas, US-152): promover número avulso contra um Postgres efêmero real com
// dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';

describe('T-234: promover número avulso', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/whatsapp/promover/route');

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const promover = (corpo: unknown, cookie: string | null = amb.cookieA) =>
    rota.POST(new NextRequest('http://localhost/api/whatsapp/promover', { method: 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    // 5511988880001 (com nono dígito) é o avulso nas duas empresas; as mensagens vieram nas duas grafias
    sql(`INSERT INTO whatsapp_mensagens (empresa_id, numero, mensagem, direcao) VALUES
           ('${empresaA}', '5511988880001', 'oi A', 'recebida'), ('${empresaA}', '551188880001', 'oi A sem nono', 'recebida'),
           ('${empresaA}', '5511977770002', 'outro número', 'recebida'),
           ('${empresaB}', '5511988880001', 'oi B', 'recebida');
         UPDATE leads SET telefone_e164 = '5511966660003' WHERE id = '${amb.tenants.leadA}';`);
    rota = await import('../../src/app/api/whatsapp/promover/route');
  }, 180_000);

  afterAll(async () => {
    await amb?.parar();
  });

  test('promover cria o lead, o card em "Entrada de leads" com o responsável e liga as mensagens das duas grafias @spec:AC-647', async () => {
    const r = await promover({ numero: '(11) 98888-0001', nome: '  Dra. Ana  ' });
    expect(r.status).toBe(201);
    const corpo = await r.json();
    expect(corpo.mensagensVinculadas).toBe(2);
    expect(sql(`SELECT nome || '|' || telefone_e164 || '|' || origem FROM leads WHERE id = '${corpo.leadId}'`)).toBe('Dra. Ana|5511988880001|WhatsApp');
    expect(sql(`SELECT etapa_id || '|' || (responsavel_id IS NOT NULL)::text FROM oportunidades WHERE id = '${corpo.oportunidadeId}'`)).toBe('1|true');
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens WHERE lead_id = '${corpo.leadId}'`)).toBe('2');
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens WHERE numero = '5511977770002' AND lead_id IS NULL`)).toBe('1');
  });

  test('só a empresa que promoveu tem as mensagens ligadas; a outra continua avulsa @spec:AC-649', async () => {
    expect(sql(`SELECT count(*) FROM whatsapp_mensagens WHERE empresa_id = '${amb.tenants.empresaB}' AND numero = '5511988880001' AND lead_id IS NULL`)).toBe('1');
  });

  test('nome vazio, número inválido, número que já é de um lead e falta de sessão são recusados sem criar nada @spec:AC-648', async () => {
    const antes = sql('SELECT count(*) FROM leads');
    const semNome = await promover({ numero: '5511977770002', nome: '  ' });
    expect(semNome.status).toBe(400);
    expect((await semNome.json()).codigo).toBe('NOME_OBRIGATORIO');
    const invalido = await promover({ numero: '12', nome: 'Fulano' });
    expect(invalido.status).toBe(400);
    expect((await invalido.json()).codigo).toBe('NUMERO_INVALIDO');
    const jaLead = await promover({ numero: '5511966660003', nome: 'Fulano' });
    expect(jaLead.status).toBe(409);
    expect((await jaLead.json()).codigo).toBe('NUMERO_JA_E_LEAD');
    // o número recém-promovido (em outra grafia) também já é de um lead
    expect((await promover({ numero: '551188880001', nome: 'De novo' })).status).toBe(409);
    expect((await promover({ numero: '5511977770002', nome: 'Fulano' }, null)).status).toBe(401);
    expect(sql('SELECT count(*) FROM leads')).toBe(antes);
  });
});

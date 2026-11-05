// T-287 (fase4-pipeline-telas, US-109): a edição dos dados do card contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const OUTRO_LEAD = 'aaaaaaaa-1111-4111-8111-00000000e001';
const CARD_PROPOSTA = 'aaaaaaaa-1111-4111-8111-00000000e002';
const LEAD_PROPOSTA = 'aaaaaaaa-1111-4111-8111-00000000e003';

describe('T-287: PATCH /api/oportunidades/:id (editar o card)', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/oportunidades/[id]/route');
  let atendente: string;
  let gerenteB: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const editar = (id: string, corpo: unknown, cookie: string | null = atendente) =>
    rota.PATCH(
      new NextRequest(`http://localhost/api/oportunidades/${id}`, {
        method: 'PATCH',
        headers: { ...(cookie ? { Cookie: cookie } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      }),
      { params: Promise.resolve({ id }) }
    );
  const cardA = () => amb.tenants.oportunidadeA;
  const leitura = (coluna: string) => sql(`SELECT ${coluna} FROM leads WHERE id = '${amb.tenants.leadA}'`);

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.edicao@teste.com', 'ATENDENTE');
    gerenteB = await cookieDePapel(amb, 'gerente.b.edicao@teste.com', 'GERENTE', amb.tenants.empresaB);
    sql(`INSERT INTO leads (id, empresa_id, nome, telefone_e164) VALUES ('${OUTRO_LEAD}', '${amb.tenants.empresaA}', 'Outro lead', '5511977776666')`);
    sql(`INSERT INTO leads (id, empresa_id, nome, telefone_e164) VALUES ('${LEAD_PROPOSTA}', '${amb.tenants.empresaA}', 'Lead proposta', '5511955554444')`);
    sql(`INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, valor, proxima_acao_em)
         VALUES ('${CARD_PROPOSTA}', '${amb.tenants.empresaA}', '${LEAD_PROPOSTA}', 11, 1000, now() + interval '2 days')`);
    rota = await import('../../src/app/api/oportunidades/[id]/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('edita nome, e-mail, origem, telefone e valor e registra o que mudou na linha do tempo, com o autor @spec:AC-736', async () => {
    expect((await editar(cardA(), { nome: 'x' }, null)).status).toBe(401);

    const r = await editar(cardA(), {
      nome: '  Clínica Nova  ',
      email: 'contato@clinica.com.br',
      origem: 'Indicação',
      telefone: '(11) 98765-4321',
      valor: '2500,50',
    });
    expect(r.status).toBe(200);
    expect((await r.json()).alteracoes.map((a: { campo: string }) => a.campo).sort()).toEqual(['email', 'nome', 'origem', 'telefone', 'valor']);
    expect(sql(`SELECT nome || '|' || email || '|' || origem || '|' || telefone_e164 FROM leads WHERE id = '${amb.tenants.leadA}'`)).toBe(
      'Clínica Nova|contato@clinica.com.br|Indicação|5511987654321'
    );
    expect(sql(`SELECT valor FROM oportunidades WHERE id = '${cardA()}'`)).toBe('2500.50');

    const evento = sql(`SELECT tipo || '|' || ator_tipo || '|' || (ator_id IS NOT NULL) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'edicao_card'`);
    expect(evento).toBe('edicao_card|usuario|true');
  });

  test('a especialidade fica em leads.dados: variação conhecida vira o nome padrão, o resto de dados é preservado e vazio a apaga @spec:AC-736', async () => {
    sql(`UPDATE leads SET dados = '{"anuncio": "AD 06", "campanha": "Leads out"}'::jsonb WHERE id = '${amb.tenants.leadA}'`);

    const r = await editar(cardA(), { especialidade: ' Fisioterapeuta ' });
    expect(r.status).toBe(200);
    expect((await r.json()).alteracoes).toEqual([{ campo: 'especialidade', de: null, para: 'Fisioterapia' }]);
    expect(sql(`SELECT dados->>'especialidade' || '|' || (dados->>'anuncio') || '|' || (dados->>'campanha') FROM leads WHERE id = '${amb.tenants.leadA}'`)).toBe('Fisioterapia|AD 06|Leads out');

    // O detalhe devolve a especialidade e os dados do anúncio.
    const detalhe = await (
      await rota.GET(new NextRequest(`http://localhost/api/oportunidades/${cardA()}`, { headers: { Cookie: atendente } }), { params: Promise.resolve({ id: cardA() }) })
    ).json();
    expect(detalhe).toMatchObject({ especialidade: 'Fisioterapia', anuncio: 'AD 06', campanha: 'Leads out', formulario: null });

    // Texto que não é nome conhecido fica como foi digitado; repetir não grava nada.
    expect((await (await editar(cardA(), { especialidade: 'Medicina Fetal' })).json()).alteracoes).toEqual([{ campo: 'especialidade', de: 'Fisioterapia', para: 'Medicina Fetal' }]);
    expect((await (await editar(cardA(), { especialidade: 'Medicina Fetal' })).json()).alteracoes).toEqual([]);

    // Vazio apaga só a especialidade.
    expect((await (await editar(cardA(), { especialidade: '' })).json()).alteracoes).toEqual([{ campo: 'especialidade', de: 'Medicina Fetal', para: null }]);
    expect(sql(`SELECT (dados ? 'especialidade') || '|' || (dados->>'anuncio') FROM leads WHERE id = '${amb.tenants.leadA}'`)).toBe('false|AD 06');
  });

  test('só grava o que mudou: repetir a mesma edição não cria evento nem altera nada; vazio no e-mail e no valor limpa @spec:AC-737', async () => {
    const antes = sql(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'edicao_card'`);
    const r = await editar(cardA(), { nome: 'Clínica Nova', telefone: '+55 11 98765-4321', valor: 2500.5 });
    expect((await r.json()).alteracoes).toEqual([]);
    expect(sql(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'edicao_card'`)).toBe(antes);

    const limpou = await editar(cardA(), { email: '', valor: null });
    expect((await limpou.json()).alteracoes).toEqual([
      { campo: 'email', de: 'contato@clinica.com.br', para: null },
      { campo: 'valor', de: '2500.50', para: null },
    ]);
    expect(leitura('email')).toBe('');
    const payload = sql(`SELECT payload->'alteracoes'->0->>'campo' FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'edicao_card' ORDER BY ocorrido_em DESC LIMIT 1`);
    expect(payload).toBe('email');
  });

  test('recusa campo inválido (400 com o campo), telefone de outro lead (409) e valor vazio na Proposta (422), sem gravar nada @spec:AC-736', async () => {
    for (const [corpo, campo] of [
      [{ nome: '   ' }, 'nome'],
      [{ origem: '' }, 'origem'],
      [{ email: 'sem-arroba' }, 'email'],
      [{ telefone: '123' }, 'telefone'],
      [{ valor: -5 }, 'valor'],
      [{ valor: 'abc' }, 'valor'],
      [{ nome: 123 }, 'nome'],
    ] as Array<[Record<string, unknown>, string]>) {
      const r = await editar(cardA(), corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(400);
      expect((await r.json()).campo).toBe(campo);
    }
    expect((await editar(cardA(), [1, 2])).status).toBe(400);

    const repetido = await editar(cardA(), { telefone: '11 97777-6666' });
    expect(repetido.status).toBe(409);
    expect(leitura('telefone_e164')).toBe('5511987654321');

    const proposta = await editar(CARD_PROPOSTA, { valor: null });
    expect(proposta.status).toBe(422);
    expect(sql(`SELECT valor FROM oportunidades WHERE id = '${CARD_PROPOSTA}'`)).toBe('1000.00');
    expect((await editar(CARD_PROPOSTA, { valor: 1800 })).status).toBe(200);
  });

  test('card de outra empresa ou inexistente é 404 e nada muda @spec:AC-736', async () => {
    expect((await editar(amb.tenants.oportunidadeB, { nome: 'Invasor' })).status).toBe(404);
    expect(sql(`SELECT nome FROM leads WHERE id = '${amb.tenants.leadB}'`)).toBe('Lead da Empresa B');
    expect((await editar('aaaaaaaa-1111-4111-8111-00000000ffff', { nome: 'X' })).status).toBe(404);
    expect((await editar(cardA(), { nome: 'Da empresa B' }, gerenteB)).status).toBe(404);
  });
});

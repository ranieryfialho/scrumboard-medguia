// T-274 (fase5-email-descadastro, AC-718): a nova campanha deixa de fora quem a empresa descadastrou — prévia e criação
// batem. Contra um Postgres efêmero real com dois tenants.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { prepararAmbienteAnexos, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

const ID = (n: number) => `f6f6f6f6-7180-0000-0000-0000000000${String(n).padStart(2, '0')}`;

describe('T-274: campanha sem descadastrados', () => {
  let amb: AmbienteAnexos;
  let rotaCampanhas: typeof import('../../src/app/api/campanhas/route');
  let rotaPrevia: typeof import('../../src/app/api/campanhas/previa-destinatarios/route');
  let gerente: string;

  function sql(texto: string) {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }
  const previa = () => rotaPrevia.GET(new NextRequest('http://localhost/api/campanhas/previa-destinatarios?etapaIds=5', { headers: { Cookie: gerente } }));
  const criar = (origem: unknown) =>
    rotaCampanhas.POST(new NextRequest('http://localhost/api/campanhas', { method: 'POST', headers: { Cookie: gerente, 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Camp', assunto: 'Assunto', corpoHtml: '<p>Oi {{nome}}</p>', origem }) }));

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    const { empresaA, empresaB } = amb.tenants;
    gerente = await cookieDePapel(amb, 'gerente.f718@teste.com', 'GERENTE');
    sql(`INSERT INTO leads (id, empresa_id, nome, email) VALUES
           ('${ID(1)}', '${empresaA}', 'Ana', 'ana@x.com'), ('${ID(2)}', '${empresaA}', 'Bia', 'bia@x.com'), ('${ID(3)}', '${empresaA}', 'Caio', 'caio@x.com');
         INSERT INTO oportunidades (id, empresa_id, lead_id, etapa_id, valor) VALUES
           ('${ID(11)}', '${empresaA}', '${ID(1)}', 5, 1000), ('${ID(12)}', '${empresaA}', '${ID(2)}', 5, 2000), ('${ID(13)}', '${empresaA}', '${ID(3)}', 5, 4000);
         INSERT INTO email_descadastros (empresa_id, email) VALUES ('${empresaA}', 'bia@x.com'), ('${empresaB}', 'caio@x.com');`);
    rotaCampanhas = await import('../../src/app/api/campanhas/route');
    rotaPrevia = await import('../../src/app/api/campanhas/previa-destinatarios/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('a prévia desconta os descadastrados da empresa (e só os dela), e o valor em pipeline também @spec:AC-718', async () => {
    const corpo = await (await previa()).json();
    // Ana e Caio (Caio saiu só da empresa B, então para a A segue valendo); Bia saiu da A
    expect(corpo.total).toBe(2);
    expect(corpo.descadastrados).toBe(1);
    expect(corpo.porEtapa).toEqual([{ etapaId: 5, total: 2 }]);
    expect(corpo.valorEmPipeline).toBe(5000);
  });

  test('criar pelas etapas e por lista colada deixa os descadastrados de fora, e o total criado bate com a prévia @spec:AC-718', async () => {
    const porEtapa = await (await criar({ tipo: 'etapa', etapaId: 5 })).json();
    expect(porEtapa.totalDestinatarios).toBe(2);
    expect(porEtapa.descartadosDescadastrados).toBe(1);
    expect(sql(`SELECT string_agg(email_destinatario, ',' ORDER BY email_destinatario) FROM envios_campanha WHERE campanha_id = '${porEtapa.id}'`)).toBe('ana@x.com,caio@x.com');

    const porLista = await (await criar({ tipo: 'planilha', contatos: [{ nome: 'Bia', email: 'BIA@x.com' }, { nome: 'Dani', email: 'dani@x.com' }, { nome: 'Dani 2', email: 'dani@x.com' }] })).json();
    expect(porLista).toMatchObject({ totalDestinatarios: 1, descartadosRepetidos: 1, descartadosDescadastrados: 1 });
    expect(sql(`SELECT string_agg(email_destinatario, ',') FROM envios_campanha WHERE campanha_id = '${porLista.id}'`)).toBe('dani@x.com');
  });
});

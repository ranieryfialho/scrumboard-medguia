// Testes de T-168 (fase4-card-abas, US-112): migration 0013 (coluna `nome`
// em `anexos`) e o upload (`POST /api/anexos`) guardando o nome original do
// arquivo, contra um Postgres 15 efêmero real.
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { limparNomeArquivo } from '../../src/lib/anexos/nome';
import { PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';

function postAnexo(cookie: string, oportunidadeId: string, arquivo: Uint8Array, nome: string) {
  const form = new FormData();
  form.set('oportunidadeId', oportunidadeId);
  form.set('arquivo', new File([arquivo as BlobPart], nome, { type: 'image/png' }));
  return new NextRequest('http://localhost/api/anexos', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
}

describe('T-168: nome original do anexo (migration 0013 e upload)', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/anexos/route');

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    rota = await import('../../src/app/api/anexos/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  function nomeGravado(anexoId: string) {
    const resultado = amb.pg.psqlComo('crm_migrator', `SELECT "nome" FROM "anexos" WHERE "id" = '${anexoId}'`);
    const bruto = resultado.stdout.trim();
    return bruto === '' ? null : bruto;
  }

  test('o nome original do arquivo enviado é guardado e devolvido @spec:AC-428', async () => {
    const resposta = await rota.POST(
      postAnexo(amb.cookieA, amb.tenants.oportunidadeA, preencher(PNG, 64), 'Proposta Comercial v1.2.pdf')
    );
    expect(resposta.status).toBe(201);
    const { anexoId } = await resposta.json();

    expect(nomeGravado(anexoId)).toBe('Proposta Comercial v1.2.pdf');
  });

  test('nome com pasta e mais de 120 caracteres é limpo antes de gravar @spec:AC-428', async () => {
    const nomeSujo = `../../etc/relatório ${'x'.repeat(130)}.png`;
    const resposta = await rota.POST(
      postAnexo(amb.cookieA, amb.tenants.oportunidadeA, preencher(PNG, 64), nomeSujo)
    );
    expect(resposta.status).toBe(201);
    const { anexoId } = await resposta.json();

    const gravado = nomeGravado(anexoId);
    expect(gravado).not.toBeNull();
    expect(gravado).toBe(limparNomeArquivo(nomeSujo));
    expect(gravado).not.toMatch(/[/\\]/);
    expect(gravado!.length).toBeLessThanOrEqual(120);
  });

  test('nome que fica vazio depois de limpo grava nulo, não string vazia @spec:AC-428', async () => {
    const resposta = await rota.POST(postAnexo(amb.cookieA, amb.tenants.oportunidadeA, preencher(PNG, 64), '   '));
    expect(resposta.status).toBe(201);
    const { anexoId } = await resposta.json();

    expect(nomeGravado(anexoId)).toBeNull();
  });

  test('limparNomeArquivo: só o último trecho do caminho, sem controle, até 120 caracteres @spec:AC-428', () => {
    expect(limparNomeArquivo('Proposta Comercial v1.2.pdf')).toBe('Proposta Comercial v1.2.pdf');
    expect(limparNomeArquivo('../../etc/passwd.png')).toBe('passwd.png');
    expect(limparNomeArquivo('C:\\pastas\\arquivo.pdf')).toBe('arquivo.pdf');
    expect(limparNomeArquivo('a\u0000b\u001fc\u007f.png')).toBe('abc.png');
    expect(limparNomeArquivo('x'.repeat(200) + '.png')).toHaveLength(120);
    expect(limparNomeArquivo('   ')).toBeNull();
    expect(limparNomeArquivo('')).toBeNull();
  });
});

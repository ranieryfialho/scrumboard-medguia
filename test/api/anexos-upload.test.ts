// Testes de T-055 (fase2c-anexos, US-034): rota POST /api/anexos contra um
// Postgres 15 efêmero real, dois tenants e um volume temporário.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  PDF_CABECALHO,
  PNG,
  prepararAmbienteAnexos,
  preencher,
  type AmbienteAnexos,
} from '../support/api-anexos';

const MB = 1024 * 1024;

interface CamposUpload {
  oportunidadeId?: string;
  arquivo?: Uint8Array;
  nome?: string;
  tipo?: string;
}

function postAnexo(cookie: string | null, campos: CamposUpload) {
  const form = new FormData();
  if (campos.oportunidadeId !== undefined) form.set('oportunidadeId', campos.oportunidadeId);
  if (campos.arquivo) {
    form.set(
      'arquivo',
      new File([campos.arquivo as BlobPart], campos.nome ?? 'print.png', { type: campos.tipo ?? 'image/png' })
    );
  }
  return new NextRequest('http://localhost/api/anexos', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: form,
  });
}

describe('T-055: rota POST /api/anexos', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/anexos/route');

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    rota = await import('../../src/app/api/anexos/route');
  }, 120_000);

  afterAll(async () => {
    await amb?.parar();
  });

  function arquivosNoVolume() {
    return readdir(amb.volume);
  }
  function contarAnexos() {
    return amb.pg.psqlComo('crm_migrator', `SELECT count(*) FROM "anexos"`).stdout.trim();
  }

  test('PNG válido: 201, registro completo e bytes no volume @spec:AC-095', async () => {
    const conteudo = preencher(PNG, 1 * MB);
    const resposta = await rota.POST(
      postAnexo(amb.cookieA, { oportunidadeId: amb.tenants.oportunidadeA, arquivo: conteudo })
    );
    const corpo = await resposta.json();

    expect(resposta.status).toBe(201);
    expect(corpo.anexoId).toMatch(/^[0-9a-f-]{36}$/);

    const consulta = amb.pg.psqlComo(
      'crm_migrator',
      `SELECT "empresa_id", "oportunidade_id", "mime", "tamanho", "hash", "caminho", ("enviado_por" IS NOT NULL) FROM "anexos" WHERE "id" = '${corpo.anexoId}'`
    );
    const [empresa, oportunidade, mime, tamanho, hash, caminho, temAutor] = consulta.stdout.trim().split('|');
    expect(empresa).toBe(amb.tenants.empresaA);
    expect(oportunidade).toBe(amb.tenants.oportunidadeA);
    expect(mime).toBe('image/png');
    expect(Number(tamanho)).toBe(1 * MB);
    expect(hash).toBe(createHash('sha256').update(conteudo).digest('hex'));
    expect(temAutor).toBe('t');
    expect(Buffer.from(await readFile(path.join(amb.volume, caminho)))).toEqual(Buffer.from(conteudo));
  });

  test('arquivo que não é imagem/PDF de verdade: 415 e nada é gravado @spec:AC-096', async () => {
    const antesVolume = (await arquivosNoVolume()).length;
    const antesBanco = contarAnexos();
    const executavel = new TextEncoder().encode('MZ isto é um executável, não um PNG');

    const resposta = await rota.POST(
      postAnexo(amb.cookieA, {
        oportunidadeId: amb.tenants.oportunidadeA,
        arquivo: executavel,
        nome: 'foto.png',
        tipo: 'image/png',
      })
    );

    expect(resposta.status).toBe(415);
    expect((await resposta.json()).codigo).toBe('TIPO_NAO_PERMITIDO');
    expect((await arquivosNoVolume()).length).toBe(antesVolume);
    expect(contarAnexos()).toBe(antesBanco);
  });

  test('imagem de 5 MB + 1 byte e PDF de 10 MB + 1 byte: 413; PDF de 8 MB: 201 @spec:AC-097', async () => {
    const antesVolume = (await arquivosNoVolume()).length;

    const imagemGrande = await rota.POST(
      postAnexo(amb.cookieA, { oportunidadeId: amb.tenants.oportunidadeA, arquivo: preencher(PNG, 5 * MB + 1) })
    );
    const pdfGrande = await rota.POST(
      postAnexo(amb.cookieA, {
        oportunidadeId: amb.tenants.oportunidadeA,
        arquivo: preencher(PDF_CABECALHO, 10 * MB + 1),
        nome: 'ata.pdf',
        tipo: 'application/pdf',
      })
    );
    expect(imagemGrande.status).toBe(413);
    expect((await imagemGrande.json()).codigo).toBe('ARQUIVO_GRANDE_DEMAIS');
    expect(pdfGrande.status).toBe(413);
    expect((await arquivosNoVolume()).length).toBe(antesVolume);

    const pdfOk = await rota.POST(
      postAnexo(amb.cookieA, {
        oportunidadeId: amb.tenants.oportunidadeA,
        arquivo: preencher(PDF_CABECALHO, 8 * MB),
        nome: 'ata.pdf',
        tipo: 'application/pdf',
      })
    );
    expect(pdfOk.status).toBe(201);
  });

  test('nome original malicioso não decide onde o arquivo fica @spec:AC-098', async () => {
    const antes = new Set(await arquivosNoVolume());
    const resposta = await rota.POST(
      postAnexo(amb.cookieA, {
        oportunidadeId: amb.tenants.oportunidadeA,
        arquivo: preencher(PNG, 64),
        nome: '../../etc/passwd.png',
      })
    );
    expect(resposta.status).toBe(201);
    const { anexoId } = await resposta.json();

    const novos = (await arquivosNoVolume()).filter((f) => !antes.has(f));
    expect(novos).toHaveLength(1);
    expect(novos[0]).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(novos[0]).not.toMatch(/passwd|\.\./);
    const caminho = amb.pg
      .psqlComo('crm_migrator', `SELECT "caminho" FROM "anexos" WHERE "id" = '${anexoId}'`)
      .stdout.trim();
    expect(caminho).toBe(novos[0]);
  });

  test('card de outro tenant ou inexistente: 404 e nada gravado @spec:AC-099', async () => {
    const antesVolume = (await arquivosNoVolume()).length;
    const antesBanco = contarAnexos();

    // Usuário da empresa B tentando anexar ao card da empresa A.
    const alheio = await rota.POST(
      postAnexo(amb.cookieB, { oportunidadeId: amb.tenants.oportunidadeA, arquivo: preencher(PNG, 64) })
    );
    const inexistente = await rota.POST(
      postAnexo(amb.cookieA, { oportunidadeId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', arquivo: preencher(PNG, 64) })
    );

    expect(alheio.status).toBe(404);
    expect((await alheio.json()).codigo).toBe('OPORTUNIDADE_NAO_ENCONTRADA');
    expect(inexistente.status).toBe(404);
    expect((await arquivosNoVolume()).length).toBe(antesVolume);
    expect(contarAnexos()).toBe(antesBanco);
  });

  test('sem sessão: 401 e nada gravado @spec:AC-100', async () => {
    const antesVolume = (await arquivosNoVolume()).length;
    const antesBanco = contarAnexos();

    const resposta = await rota.POST(
      postAnexo(null, { oportunidadeId: amb.tenants.oportunidadeA, arquivo: preencher(PNG, 64) })
    );

    expect(resposta.status).toBe(401);
    expect((await resposta.json()).codigo).toBe('NAO_AUTENTICADO');
    expect((await arquivosNoVolume()).length).toBe(antesVolume);
    expect(contarAnexos()).toBe(antesBanco);
  });
});

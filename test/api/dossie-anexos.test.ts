// T-293 (fase4-card-abas, US-112): GET /api/oportunidades/:id/dossie contra um Postgres efêmero real, dois tenants e um volume
// temporário: o ZIP traz os anexos e o manifesto, avisa arquivo que sumiu ou mudou, e fica registrado na linha do tempo.
import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { PDF_CABECALHO, PNG, prepararAmbienteAnexos, preencher, type AmbienteAnexos } from '../support/api-anexos';
import { cookieDePapel } from '../support/atendente';

function nomesNoZip(zip: Buffer): string[] {
  const fim = zip.length - 22;
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const nomes: string[] = [];
  for (let i = 0; i < total; i++) {
    const nomeLen = zip.readUInt16LE(p + 28);
    nomes.push(zip.subarray(p + 46, p + 46 + nomeLen).toString('utf8'));
    p += 46 + nomeLen;
  }
  return nomes;
}

function conteudoNoZip(zip: Buffer, nome: string): Buffer {
  const fim = zip.length - 22;
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  for (let i = 0; i < total; i++) {
    const nomeLen = zip.readUInt16LE(p + 28);
    if (zip.subarray(p + 46, p + 46 + nomeLen).toString('utf8') === nome) {
      const local = zip.readUInt32LE(p + 42);
      const tamanho = zip.readUInt32LE(p + 24);
      const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      return zip.subarray(inicio, inicio + tamanho);
    }
    p += 46 + nomeLen;
  }
  throw new Error(`${nome} não está no ZIP`);
}

describe('T-293: GET /api/oportunidades/:id/dossie', () => {
  let amb: AmbienteAnexos;
  let rota: typeof import('../../src/app/api/oportunidades/[id]/dossie/route');
  let atendente: string;
  const sql = (texto: string) => {
    const r = amb.pg.psqlComo('crm_migrator', texto);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const dossie = (id: string, cookie: string | null = atendente) =>
    rota.GET(new NextRequest(`http://localhost/api/oportunidades/${id}/dossie`, { headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ id }) });
  const cardA = () => amb.tenants.oportunidadeA;

  /** Grava o arquivo no volume e a linha em `anexos`, como o upload faz. */
  async function inserirAnexo(opts: { id: string; oportunidadeId: string; empresaId: string; nome: string | null; mime: string; bytes: Uint8Array; hash?: string; gravar?: boolean; criadoEm: string }) {
    const caminho = `${opts.id}.bin`;
    if (opts.gravar !== false) await writeFile(path.join(amb.volume, caminho), opts.bytes);
    const hash = opts.hash ?? createHash('sha256').update(opts.bytes).digest('hex');
    sql(
      `INSERT INTO anexos (id, empresa_id, oportunidade_id, caminho, mime, tamanho, hash, nome, criado_em)
       VALUES ('${opts.id}', '${opts.empresaId}', '${opts.oportunidadeId}', '${caminho}', '${opts.mime}', ${opts.bytes.length}, '${hash}', ${opts.nome === null ? 'NULL' : `'${opts.nome}'`}, '${opts.criadoEm}')`
    );
  }

  beforeAll(async () => {
    amb = await prepararAmbienteAnexos();
    atendente = await cookieDePapel(amb, 'atendente.dossie@teste.com', 'ATENDENTE');
    rota = await import('../../src/app/api/oportunidades/[id]/dossie/route');
  }, 180_000);
  afterAll(async () => {
    await amb?.parar();
  });

  test('card sem anexo é 422, sem sessão é 401, e card de outra empresa ou inexistente é 404 @spec:AC-750', async () => {
    expect((await dossie(cardA())).status).toBe(422);
    expect((await dossie(cardA(), null)).status).toBe(401);
    expect((await dossie(amb.tenants.oportunidadeB)).status).toBe(404);
    expect((await dossie('aaaaaaaa-1111-4111-8111-00000000ffff')).status).toBe(404);
    expect((await dossie('nao-e-uuid')).status).toBe(404);
    expect(sql(`SELECT count(*) FROM oportunidade_eventos WHERE tipo = 'dossie_exportado'`)).toBe('0');
  });

  test('o ZIP traz os anexos com o nome original, do mais antigo ao mais novo, e o manifesto com o SHA-256 de cada um @spec:AC-750', async () => {
    const png = preencher(PNG, 300);
    const pdf = preencher(PDF_CABECALHO, 500);
    await inserirAnexo({ id: 'dddddddd-0000-4000-8000-000000000001', oportunidadeId: cardA(), empresaId: amb.tenants.empresaA, nome: 'print.png', mime: 'image/png', bytes: png, criadoEm: '2026-10-01T10:00:00Z' });
    await inserirAnexo({ id: 'dddddddd-0000-4000-8000-000000000002', oportunidadeId: cardA(), empresaId: amb.tenants.empresaA, nome: 'print.png', mime: 'image/png', bytes: preencher(PNG, 310), criadoEm: '2026-10-02T10:00:00Z' });
    await inserirAnexo({ id: 'dddddddd-0000-4000-8000-000000000003', oportunidadeId: cardA(), empresaId: amb.tenants.empresaA, nome: 'Proposta é final.pdf', mime: 'application/pdf', bytes: pdf, criadoEm: '2026-10-03T10:00:00Z' });
    await inserirAnexo({ id: 'dddddddd-0000-4000-8000-000000000004', oportunidadeId: cardA(), empresaId: amb.tenants.empresaA, nome: null, mime: 'application/pdf', bytes: preencher(PDF_CABECALHO, 90), criadoEm: '2026-10-04T10:00:00Z' });
    // um anexo da outra empresa nunca entra
    await inserirAnexo({ id: 'dddddddd-0000-4000-8000-0000000000b1', oportunidadeId: amb.tenants.oportunidadeB, empresaId: amb.tenants.empresaB, nome: 'segredo-b.pdf', mime: 'application/pdf', bytes: preencher(PDF_CABECALHO, 50), criadoEm: '2026-10-01T10:00:00Z' });

    const r = await dossie(cardA());
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="dossie-lead-da-empresa-a-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const zip = Buffer.from(await r.arrayBuffer());

    expect(nomesNoZip(zip)).toEqual(['anexos/print.png', 'anexos/print (2).png', 'anexos/Proposta é final.pdf', 'anexos/anexo-dddddddd.pdf', 'manifesto.csv']);
    expect(conteudoNoZip(zip, 'anexos/Proposta é final.pdf').equals(Buffer.from(pdf))).toBe(true);

    const manifesto = conteudoNoZip(zip, 'manifesto.csv').toString('utf8');
    expect(manifesto).not.toContain('segredo-b');
    expect(manifesto.split('\r\n').filter(Boolean)).toHaveLength(5);
    expect(manifesto).toContain(createHash('sha256').update(pdf).digest('hex'));
    expect(manifesto.match(/"ok"/g)).toHaveLength(4);
  });

  test('arquivo que sumiu ou mudou no volume não derruba o dossiê: o manifesto avisa e a linha do tempo registra @spec:AC-751', async () => {
    sql(`DELETE FROM oportunidade_eventos WHERE tipo = 'dossie_exportado'`);
    await rm(path.join(amb.volume, 'dddddddd-0000-4000-8000-000000000001.bin'));
    await writeFile(path.join(amb.volume, 'dddddddd-0000-4000-8000-000000000002.bin'), preencher(PNG, 310).map((b, i) => (i === 100 ? 7 : b)));

    const r = await dossie(cardA());
    expect(r.status).toBe(200);
    const zip = Buffer.from(await r.arrayBuffer());
    expect(nomesNoZip(zip)).toEqual(['anexos/print (2).png', 'anexos/Proposta é final.pdf', 'anexos/anexo-dddddddd.pdf', 'manifesto.csv']);

    const linhas = conteudoNoZip(zip, 'manifesto.csv').toString('utf8').split('\r\n').filter(Boolean);
    expect(linhas.filter((l) => l.endsWith('"ausente"'))).toHaveLength(1);
    expect(linhas.filter((l) => l.endsWith('"divergente"'))).toHaveLength(1);
    expect(linhas.filter((l) => l.endsWith('"ok"'))).toHaveLength(2);

    expect(sql(`SELECT payload::text || '|' || ator_tipo || '|' || (ator_id IS NOT NULL) FROM oportunidade_eventos WHERE oportunidade_id = '${cardA()}' AND tipo = 'dossie_exportado'`)).toBe(
      '{"arquivos": 3, "ausentes": 1, "divergentes": 1}|usuario|true'
    );
  });
});

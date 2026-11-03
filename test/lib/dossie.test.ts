// T-293 (fase4-card-abas, US-112, AC-750/AC-751): o ZIP do dossiê e as regras de nomes e manifesto.
import { inflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';

import { LIMITE_DOSSIE_BYTES, montarManifesto, nomeDoArquivoDoDossie, nomeSeguroNoZip, nomesUnicos } from '../../src/domain/pipeline/dossie';
import { crc32, criarZip } from '../../src/lib/zip';

/** Lê o ZIP pelo diretório central — o que qualquer programa de ZIP faz —, sem usar o gerador para conferir o gerador. */
function lerZip(zip: Buffer): Array<{ nome: string; bytes: Buffer; crc: number }> {
  const fim = zip.length - 22;
  expect(zip.readUInt32LE(fim)).toBe(0x06054b50);
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const saida = [];
  for (let i = 0; i < total; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const tamanho = zip.readUInt32LE(p + 24);
    const nomeLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nomeLen).toString('utf8');
    const dadosInicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const bruto = zip.subarray(dadosInicio, dadosInicio + tamanho);
    saida.push({ nome, bytes: metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto), crc });
    p += 46 + nomeLen;
  }
  return saida;
}

describe('T-293: ZIP do dossiê', () => {
  test('o CRC-32 bate com os valores conhecidos @spec:AC-750', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  test('cada arquivo sai do ZIP com o mesmo nome (acentos incluídos), conteúdo e CRC @spec:AC-750', () => {
    const arquivos = [
      { nome: 'anexos/proposta comercial é.pdf', bytes: new TextEncoder().encode('%PDF-1.4 conteudo'), data: new Date('2026-11-03T12:00:00') },
      { nome: 'anexos/vazio.txt', bytes: new Uint8Array(0), data: new Date('2026-11-03T12:00:00') },
      { nome: 'manifesto.csv', bytes: Uint8Array.from({ length: 70000 }, (_, i) => i % 251), data: new Date('1970-01-01T00:00:00') },
    ];
    const lidos = lerZip(criarZip(arquivos));

    expect(lidos.map((l) => l.nome)).toEqual(arquivos.map((a) => a.nome));
    lidos.forEach((lido, i) => {
      expect(lido.bytes.equals(Buffer.from(arquivos[i].bytes))).toBe(true);
      expect(lido.crc).toBe(crc32(arquivos[i].bytes));
    });
    expect(lerZip(criarZip([]))).toEqual([]);
  });

  test('nomes de anexo viram nomes seguros e únicos dentro do ZIP @spec:AC-750', () => {
    expect(nomeSeguroNoZip('..\\..\\etc/passwd', 'application/pdf', 'abcdef12-0000')).toBe('.._.._etc_passwd'.replace(/^\.+/, ''));
    expect(nomeSeguroNoZip('  .oculto.png ', 'image/png', 'abcdef12-0000')).toBe('oculto.png');
    expect(nomeSeguroNoZip('a:b*c?"d<e>f|g.pdf', 'application/pdf', 'x')).toBe('a_b_c__d_e_f_g.pdf');
    expect(nomeSeguroNoZip(null, 'image/jpeg', 'abcdef12-0000')).toBe('anexo-abcdef12.jpg');
    expect(nomeSeguroNoZip('   ', 'application/pdf', 'abcdef12-0000')).toBe('anexo-abcdef12.pdf');
    expect(nomeSeguroNoZip('x'.repeat(300) + '.png', 'image/png', 'i').length).toBe(120);

    expect(nomesUnicos(['print.png', 'Print.PNG', 'print.png', 'sem-extensao', 'sem-extensao'])).toEqual([
      'print.png',
      'Print (2).PNG',
      'print (3).png',
      'sem-extensao',
      'sem-extensao (2)',
    ]);
    expect(LIMITE_DOSSIE_BYTES).toBe(100 * 1024 * 1024);
  });

  test('o manifesto é CSV com BOM, aspas dobradas e fórmulas neutralizadas, uma linha por anexo @spec:AC-751', () => {
    const csv = montarManifesto([
      {
        arquivo: 'anexos/print.png',
        nomeOriginal: '=CMD("calc").png',
        tipo: 'image/png',
        tamanho: 123,
        sha256: 'abc',
        enviadoPor: 'Ana "Dra." Souza',
        enviadoEm: new Date('2026-11-03T12:30:00Z'),
        evidencia: 'Proposta',
        integridade: 'ok',
      },
      { arquivo: '', nomeOriginal: null, tipo: 'application/pdf', tamanho: 9, sha256: 'def', enviadoPor: null, enviadoEm: new Date('2026-11-02T10:00:00Z'), evidencia: null, integridade: 'ausente' },
    ]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).trim().split('\r\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toBe('"arquivo","nome_original","tipo","tamanho_bytes","sha256","enviado_por","enviado_em_utc","evidencia_da_etapa","integridade"');
    expect(linhas[1]).toBe('"anexos/print.png","\'=CMD(""calc"").png","image/png","123","abc","Ana ""Dra."" Souza","2026-11-03T12:30:00.000Z","Proposta","ok"');
    expect(linhas[2]).toBe('"","","application/pdf","9","def","","2026-11-02T10:00:00.000Z","","ausente"');
  });

  test('o arquivo do dossiê leva o nome do lead sem acento nem símbolo e a data @spec:AC-750', () => {
    const dia = new Date('2026-11-03T15:00:00Z');
    expect(nomeDoArquivoDoDossie('Clínica Santa Luzia — Oftalmologia', dia)).toBe('dossie-clinica-santa-luzia-oftalmologia-2026-11-03.zip');
    expect(nomeDoArquivoDoDossie('???', dia)).toBe('dossie-card-2026-11-03.zip');
    expect(nomeDoArquivoDoDossie('x'.repeat(200), dia).length).toBeLessThan(80);
  });
});

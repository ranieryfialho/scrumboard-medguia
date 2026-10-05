// Testes de T-052 (fase2c-anexos): tipo pelo conteúdo, limites de tamanho e
// nome de arquivo gerado pelo servidor. Sem banco — funções puras + um
// diretório temporário como volume.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { gravarAnexo, lerAnexo } from '../../src/lib/anexos/armazenamento';
import {
  detectarTipo,
  LIMITE_IMAGEM_BYTES,
  LIMITE_PDF_BYTES,
  tamanhoPermitido,
} from '../../src/lib/anexos/conteudo';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const EXECUTAVEL = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // "MZ", cabeçalho de .exe

describe('T-052: tipo e tamanho do anexo', () => {
  test('reconhece PNG, JPEG, WebP e PDF pelos bytes @spec:AC-096', () => {
    expect(detectarTipo(PNG)).toBe('image/png');
    expect(detectarTipo(JPEG)).toBe('image/jpeg');
    expect(detectarTipo(WEBP)).toBe('image/webp');
    expect(detectarTipo(PDF)).toBe('application/pdf');
  });

  test('executável ou texto "renomeado" para .png não é nenhum tipo aceito @spec:AC-096', () => {
    expect(detectarTipo(EXECUTAVEL)).toBeNull();
    expect(detectarTipo(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(detectarTipo(new Uint8Array())).toBeNull();
    // RIFF que não é WebP (ex.: WAV) também é recusado.
    expect(detectarTipo(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });

  test('imagem: 5 MB cabe, 5 MB + 1 byte não @spec:AC-097', () => {
    expect(tamanhoPermitido('image/png', LIMITE_IMAGEM_BYTES)).toBe(true);
    expect(tamanhoPermitido('image/png', LIMITE_IMAGEM_BYTES + 1)).toBe(false);
    expect(tamanhoPermitido('image/jpeg', LIMITE_IMAGEM_BYTES + 1)).toBe(false);
  });

  test('PDF: 8 MB cabe (acima do limite de imagem), 10 MB + 1 byte não @spec:AC-097', () => {
    expect(tamanhoPermitido('application/pdf', 8 * 1024 * 1024)).toBe(true);
    expect(tamanhoPermitido('application/pdf', LIMITE_PDF_BYTES)).toBe(true);
    expect(tamanhoPermitido('application/pdf', LIMITE_PDF_BYTES + 1)).toBe(false);
  });
});

describe('T-052: armazenamento em volume', () => {
  let volume: string;

  beforeAll(async () => {
    volume = await mkdtemp(path.join(os.tmpdir(), 'anexos-'));
    process.env.ANEXOS_DIR = volume;
  });

  afterAll(async () => {
    await rm(volume, { recursive: true, force: true });
  });

  test('o nome gravado é gerado pelo servidor e nada sai do volume @spec:AC-098', async () => {
    // O nome original (`../../etc/passwd.png`) nem é parâmetro da gravação.
    const caminho = await gravarAnexo('image/png', PNG);

    expect(caminho).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(caminho).not.toMatch(/passwd|\.\./);
    expect(await readdir(volume)).toEqual([caminho]);
    expect(Buffer.from(await readFile(path.join(volume, caminho)))).toEqual(Buffer.from(PNG));
    expect(Buffer.from(await lerAnexo(caminho))).toEqual(Buffer.from(PNG));
  });

  test('ler um caminho que escapa do volume é recusado @spec:AC-098', async () => {
    await expect(lerAnexo('../fora.png')).rejects.toThrow();
    await expect(lerAnexo('a/../../fora.png')).rejects.toThrow();
  });
});

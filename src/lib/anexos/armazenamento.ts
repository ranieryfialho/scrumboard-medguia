// T-052 (fase2c-anexos, US-034): grava e lê os bytes dos anexos no volume
// Docker (ASM-025). O nome do arquivo é SEMPRE gerado aqui (uuid + extensão
// do tipo detectado) — o nome original enviado pelo navegador não chega nem
// a este módulo (AC-098).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { extensaoDoTipo, type TipoAnexo } from './conteudo';

export function diretorioDeAnexos(): string {
  return path.resolve(process.env.ANEXOS_DIR || '/data/anexos');
}

/** Grava `bytes` e devolve o `caminho` relativo ao volume (é o que vai para `anexos.caminho`). */
export async function gravarAnexo(tipo: TipoAnexo, bytes: Uint8Array): Promise<string> {
  const base = diretorioDeAnexos();
  await mkdir(base, { recursive: true });
  const caminho = `${randomUUID()}.${extensaoDoTipo(tipo)}`;
  await writeFile(path.join(base, caminho), bytes, { flag: 'wx' });
  return caminho;
}

/** Lê um anexo pelo `caminho` gravado; recusa qualquer caminho que escape do volume. */
export async function lerAnexo(caminho: string): Promise<Uint8Array> {
  const base = diretorioDeAnexos();
  const completo = path.resolve(base, caminho);
  if (path.dirname(completo) !== base) {
    throw new Error('Caminho de anexo fora do volume.');
  }
  return readFile(completo);
}

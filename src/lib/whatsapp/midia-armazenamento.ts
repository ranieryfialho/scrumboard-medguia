// T-290 (fase4-card-abas, US-114, AC-744/AC-745): grava e lê os arquivos de mídia do WhatsApp no mesmo volume dos anexos
// (`ANEXOS_DIR`), numa pasta própria. O nome do arquivo é sempre gerado aqui (uuid + extensão do tipo permitido): nada que veio do
// navegador ou da Evolution entra no caminho.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { diretorioDeAnexos } from '../anexos/armazenamento';

const PASTA = 'whatsapp';

function pasta(): string {
  return path.join(diretorioDeAnexos(), PASTA);
}

/** Grava `bytes` e devolve o caminho relativo ao volume (é o que vai para `whatsapp_mensagens.midia_arquivo`). */
export async function gravarMidia(extensao: string, bytes: Uint8Array): Promise<string> {
  await mkdir(pasta(), { recursive: true });
  const nome = `${randomUUID()}.${extensao.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'}`;
  await writeFile(path.join(pasta(), nome), bytes, { flag: 'wx' });
  return `${PASTA}/${nome}`;
}

/** Lê uma mídia pelo caminho gravado; recusa qualquer caminho que escape da pasta. */
export async function lerMidia(caminho: string): Promise<Uint8Array> {
  const completo = path.resolve(diretorioDeAnexos(), caminho);
  if (path.dirname(completo) !== pasta()) throw new Error('Caminho de mídia fora do volume.');
  return readFile(completo);
}

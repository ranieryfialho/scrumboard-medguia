// T-259 (fase5-email-config, AC-696, ASM-257): cifra de segredos guardados no banco (a chave do Resend de cada
// empresa). AES-256-GCM com a chave derivada do segredo do ambiente (`SEGREDO_CONFIGURACOES`); o texto cifrado vai
// como `v1:<iv>:<tag>:<dados>` em base64url. Alterar um byte, ou usar outro segredo, faz a decifra falhar.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSAO = 'v1';
export const TAMANHO_MINIMO_DO_SEGREDO = 32;

export class ErroConfiguracaoIndisponivel extends Error {
  constructor() {
    super('SEGREDO_CONFIGURACOES não configurado (mínimo de 32 caracteres): não dá para guardar nem ler segredos.');
    this.name = 'ErroConfiguracaoIndisponivel';
  }
}

export class ErroDecifra extends Error {
  constructor() {
    super('Não foi possível decifrar o valor (segredo diferente ou dado alterado).');
    this.name = 'ErroDecifra';
  }
}

/** O segredo do ambiente, ou `null` quando falta ou é curto demais. */
export function segredoDeConfiguracoes(ambiente: NodeJS.ProcessEnv = process.env): string | null {
  const valor = ambiente.SEGREDO_CONFIGURACOES;
  return valor && valor.length >= TAMANHO_MINIMO_DO_SEGREDO ? valor : null;
}

const chaveDe = (segredo: string): Buffer => createHash('sha256').update(`cifra-configuracoes:${segredo}`).digest();

export function cifrar(texto: string, segredo: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveDe(segredo), iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return [VERSAO, iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), dados.toString('base64url')].join(':');
}

export function decifrar(cifrado: string, segredo: string): string {
  const partes = cifrado.split(':');
  if (partes.length !== 4 || partes[0] !== VERSAO) throw new ErroDecifra();
  try {
    const decifra = createDecipheriv('aes-256-gcm', chaveDe(segredo), Buffer.from(partes[1], 'base64url'));
    decifra.setAuthTag(Buffer.from(partes[2], 'base64url'));
    return Buffer.concat([decifra.update(Buffer.from(partes[3], 'base64url')), decifra.final()]).toString('utf8');
  } catch {
    throw new ErroDecifra();
  }
}

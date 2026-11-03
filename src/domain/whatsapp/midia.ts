// T-290 (fase4-card-abas, US-114, AC-744 a AC-747): regras puras da mídia do WhatsApp — que tipos aceitamos, o limite de tamanho e a
// checagem dos bytes. Sem I/O: usado pela rota de envio, pela de leitura e pelo webhook.
import { detectarTipo } from '../../lib/anexos/conteudo';

export type TipoMidia = 'audio' | 'imagem' | 'video' | 'documento' | 'figurinha';

/** O WhatsApp aceita até 16 MB em áudio, imagem e vídeo; usamos o mesmo teto para tudo. */
export const LIMITE_MIDIA_BYTES = 16 * 1024 * 1024;
/** Mais que isso o envio recusa a gravação (o navegador para sozinho). */
export const DURACAO_MAXIMA_AUDIO_S = 300;

interface TipoPermitido {
  tipo: TipoMidia;
  extensao: string;
}

/** Só o que está aqui entra ou sai: nada de HTML, SVG ou executável, que o navegador poderia rodar. */
const PERMITIDOS: Record<string, TipoPermitido> = {
  'audio/ogg': { tipo: 'audio', extensao: 'ogg' },
  'audio/webm': { tipo: 'audio', extensao: 'webm' },
  'audio/mp4': { tipo: 'audio', extensao: 'm4a' },
  'audio/mpeg': { tipo: 'audio', extensao: 'mp3' },
  'audio/wav': { tipo: 'audio', extensao: 'wav' },
  'audio/aac': { tipo: 'audio', extensao: 'aac' },
  'image/jpeg': { tipo: 'imagem', extensao: 'jpg' },
  'image/png': { tipo: 'imagem', extensao: 'png' },
  'image/webp': { tipo: 'imagem', extensao: 'webp' },
  'image/gif': { tipo: 'imagem', extensao: 'gif' },
  'video/mp4': { tipo: 'video', extensao: 'mp4' },
  'application/pdf': { tipo: 'documento', extensao: 'pdf' },
  'application/msword': { tipo: 'documento', extensao: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { tipo: 'documento', extensao: 'docx' },
  'application/vnd.ms-excel': { tipo: 'documento', extensao: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { tipo: 'documento', extensao: 'xlsx' },
  'application/vnd.ms-powerpoint': { tipo: 'documento', extensao: 'ppt' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { tipo: 'documento', extensao: 'pptx' },
  'text/plain': { tipo: 'documento', extensao: 'txt' },
  'text/csv': { tipo: 'documento', extensao: 'csv' },
};

/** `audio/ogg; codecs=opus` → `audio/ogg`. */
export function mimetypeBase(mimetype: string | null | undefined): string {
  return (mimetype ?? '').split(';')[0].trim().toLowerCase();
}

/** O tipo e a extensão de um mimetype permitido, ou `null` se não for permitido. */
export function classificarMimetype(mimetype: string | null | undefined): TipoPermitido | null {
  return PERMITIDOS[mimetypeBase(mimetype)] ?? null;
}

const COMECA_GIF = [0x47, 0x49, 0x46, 0x38]; // "GIF8"

/**
 * Confere os bytes iniciais com o que o navegador disse que é: PNG, JPEG, WebP, PDF e GIF precisam ter a assinatura certa.
 * Os demais (áudio, vídeo, Office, texto) não têm assinatura simples e passam só pelo mimetype permitido.
 */
export function bytesCombinamComMimetype(mimetype: string, bytes: Uint8Array): boolean {
  const base = mimetypeBase(mimetype);
  if (base === 'image/png' || base === 'image/jpeg' || base === 'image/webp' || base === 'application/pdf') return detectarTipo(bytes) === base;
  if (base === 'image/gif') return COMECA_GIF.every((b, i) => bytes[i] === b);
  return true;
}

/** Texto que fica na mensagem quando não há legenda; a tela não repete esse texto ao lado da mídia. */
export const TEXTO_PADRAO_DA_MIDIA: Record<TipoMidia, string> = {
  audio: '[áudio]',
  imagem: '[imagem]',
  video: '[vídeo]',
  documento: '[documento]',
  figurinha: '[figurinha]',
};

const MARCADORES = new Set([...Object.values(TEXTO_PADRAO_DA_MIDIA), '[mídia]']);

export function ehMarcadorDeMidia(texto: string): boolean {
  return MARCADORES.has(texto.trim());
}

// T-052 (fase2c-anexos, US-034): decide o tipo de um anexo pelos BYTES, nunca
// pelo `Content-Type` nem pela extensão informados pelo navegador (AC-096), e
// aplica o limite de tamanho por tipo (AC-097; ASM-023).

export type TipoAnexo = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024;
export const LIMITE_PDF_BYTES = 10 * 1024 * 1024;

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ASSINATURA_JPEG = [0xff, 0xd8, 0xff];
const ASSINATURA_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function comecaCom(bytes: Uint8Array, assinatura: number[], deslocamento = 0): boolean {
  if (bytes.length < deslocamento + assinatura.length) return false;
  return assinatura.every((b, i) => bytes[deslocamento + i] === b);
}

/** Tipo real do arquivo pelos bytes iniciais, ou `null` se não for PNG/JPEG/WebP/PDF. */
export function detectarTipo(bytes: Uint8Array): TipoAnexo | null {
  if (comecaCom(bytes, ASSINATURA_PNG)) return 'image/png';
  if (comecaCom(bytes, ASSINATURA_JPEG)) return 'image/jpeg';
  // WebP é um contêiner RIFF: "RIFF" + 4 bytes de tamanho + "WEBP".
  if (comecaCom(bytes, [0x52, 0x49, 0x46, 0x46]) && comecaCom(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (comecaCom(bytes, ASSINATURA_PDF)) return 'application/pdf';
  return null;
}

export function limiteDoTipo(tipo: TipoAnexo): number {
  return tipo === 'application/pdf' ? LIMITE_PDF_BYTES : LIMITE_IMAGEM_BYTES;
}

/** `true` se `tamanho` cabe no limite do tipo (o limite em si é aceito; +1 byte não). */
export function tamanhoPermitido(tipo: TipoAnexo, tamanho: number): boolean {
  return tamanho <= limiteDoTipo(tipo);
}

const EXTENSAO: Record<TipoAnexo, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function extensaoDoTipo(tipo: TipoAnexo): string {
  return EXTENSAO[tipo];
}

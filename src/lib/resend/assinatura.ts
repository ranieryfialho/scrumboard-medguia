// T-106 (fase2d-campanhas, US-067): verificação da assinatura do webhook do
// Resend no padrão Svix (ASM-079) — HMAC-SHA256 sobre `${svixId}.${svixTimestamp}.${corpoCru}`
// com o segredo `RESEND_WEBHOOK_SECRET` (prefixo opcional `whsec_`, valor
// base64). Falha fechada (AC-247): sem segredo configurado, sem algum dos
// três cabeçalhos, ou nenhuma das assinaturas de `svix-signature` batendo
// (pode haver mais de uma, separadas por espaço, para rotação de segredo),
// a verificação recusa.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CabecalhosSvix {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

function decodificarBase64(valor: string): Buffer | null {
  try {
    const buffer = Buffer.from(valor, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

export function verificarAssinaturaResend(
  segredo: string | undefined,
  corpoCru: string,
  cabecalhos: CabecalhosSvix
): boolean {
  if (!segredo) return false;

  const { svixId, svixTimestamp, svixSignature } = cabecalhos;
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const segredoBase64 = segredo.startsWith('whsec_') ? segredo.slice('whsec_'.length) : segredo;
  const chave = decodificarBase64(segredoBase64);
  if (!chave) return false;

  const esperado = createHmac('sha256', chave).update(`${svixId}.${svixTimestamp}.${corpoCru}`).digest('base64');
  const esperadoBuffer = Buffer.from(esperado, 'utf8');

  const assinaturasRecebidas = svixSignature
    .split(' ')
    .map((parte) => parte.split(',')[1])
    .filter((valor): valor is string => Boolean(valor));

  return assinaturasRecebidas.some((assinatura) => {
    const recebidaBuffer = Buffer.from(assinatura, 'utf8');
    return recebidaBuffer.length === esperadoBuffer.length && timingSafeEqual(recebidaBuffer, esperadoBuffer);
  });
}

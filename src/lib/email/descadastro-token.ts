// T-270 (fase5-email-descadastro, AC-714, ASM-268): o link de descadastro de um destinatário numa empresa. O token é
// `base64url(empresaId|email)` + `.` + HMAC-SHA256 com contexto próprio (`descadastro:`) e o segredo do ambiente
// (`SEGREDO_CONFIGURACOES`) — não carrega chave de ninguém, e adulterar qualquer byte o invalida. O e-mail vale sem
// diferenciar maiúsculas. Funções puras: o segredo é parâmetro.
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/;

export const normalizarEmail = (email: string): string => email.trim().toLowerCase();

const assinar = (carga: string, segredo: string): string => createHmac('sha256', segredo).update(`descadastro:${carga}`).digest('base64url');

export function gerarTokenDeDescadastro(empresaId: string, email: string, segredo: string): string {
  const carga = Buffer.from(`${empresaId.toLowerCase()}|${normalizarEmail(email)}`, 'utf8').toString('base64url');
  return `${carga}.${assinar(carga, segredo)}`;
}

export function verificarTokenDeDescadastro(token: string, segredo: string): { empresaId: string; email: string } | null {
  if (typeof token !== 'string' || token.length > 700) return null;
  const partes = token.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const esperado = Buffer.from(assinar(partes[0], segredo));
  const recebido = Buffer.from(partes[1]);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  const [empresaId, email] = Buffer.from(partes[0], 'base64url').toString('utf8').split('|');
  if (!empresaId || !email || !UUID.test(empresaId) || !EMAIL.test(email)) return null;
  return { empresaId, email };
}

/** AC-714: `<base>/descadastro/<token>`. */
export function linkDeDescadastro(baseUrl: string, empresaId: string, email: string, segredo: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/descadastro/${gerarTokenDeDescadastro(empresaId, email, segredo)}`;
}

/** ASM-270: `maria@clinica.com` vira `m***@clinica.com` na página pública. */
export function mascararEmail(email: string): string {
  const [usuario, dominio] = normalizarEmail(email).split('@');
  return `${(usuario ?? '').slice(0, 1)}***@${dominio ?? ''}`;
}

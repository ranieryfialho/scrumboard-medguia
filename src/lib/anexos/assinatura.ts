// T-053 (fase2c-anexos, US-035): URL assinada de curta duração (ASM-024).
// A assinatura é HMAC-SHA256 de `id.empresaId.expiracao` com `ANEXOS_SEGREDO`; a rota
// que serve os bytes não exige sessão — a assinatura, emitida só depois da
// checagem de tenant (AC-102), é a credencial (AC-103). A empresa vai na URL
// (e na assinatura) para a rota de arquivo ler a linha sob o RLS desse tenant.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const VALIDADE_URL_SEGUNDOS = 60;

function segredo(): string {
  const valor = process.env.ANEXOS_SEGREDO;
  // Falha fechada: sem segredo não existe URL assinada válida.
  if (!valor) throw new Error('ANEXOS_SEGREDO não configurado.');
  return valor;
}

function calcular(id: string, empresaId: string, expiracao: number): string {
  return createHmac('sha256', segredo()).update(`${id}.${empresaId}.${expiracao}`).digest('hex');
}

export interface UrlAssinada {
  /** Caminho + query, relativo à origem da aplicação. */
  url: string;
  expiracao: number;
}

/** Emite a URL do arquivo válida por 60 s a partir de `agora` (ms desde a época). */
export function assinarUrl(id: string, empresaId: string, agora: number = Date.now()): UrlAssinada {
  const expiracao = Math.floor(agora / 1000) + VALIDADE_URL_SEGUNDOS;
  const assinatura = calcular(id, empresaId, expiracao);
  const url = `/api/anexos/arquivo/${id}?emp=${empresaId}&exp=${expiracao}&sig=${assinatura}`;
  return { url, expiracao };
}

/** `true` só se `exp` não passou e `sig` é a assinatura de `id.empresaId.exp` (comparação em tempo constante). */
export function verificarAssinatura(
  id: string,
  empresaId: string,
  exp: string | null,
  sig: string | null,
  agora: number = Date.now()
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const expiracao = Number(exp);
  if (Math.floor(agora / 1000) > expiracao) return false;

  const esperada = Buffer.from(calcular(id, empresaId, expiracao), 'hex');
  const recebida = Buffer.from(sig, 'hex');
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
}

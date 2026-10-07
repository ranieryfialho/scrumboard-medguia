// T-072 (fase2c-whatsapp-conversa): normalização pura de telefone (sem I/O,
// ASM-046), usada pelo envio (AC-143), pelo histórico (AC-149) e pelo
// cadastro de telefones extras do lead (AC-161, AC-162). `variantesNumero`
// (hoje privada em src/repositories/whatsapp.ts) muda de lugar para cá para
// ser reaproveitada fora do webhook de entrada.

/**
 * Normaliza `entrada` para só dígitos, acrescenta o DDI 55 quando o
 * resultado tiver 10 ou 11 dígitos (padrão brasileiro sem DDI) e valida o
 * tamanho final entre 10 e 15 dígitos (ASM-046). Fora desse intervalo:
 * `null` — usado para recusar `numero` mal formado (AC-143, AC-162).
 */
export function normalizarNumero(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, '');
  const comDdi = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;

  if (comDdi.length < 10 || comDdi.length > 15) return null;
  return comDdi;
}

/**
 * Gera as variações do nono dígito do padrão brasileiro (55 + DDD(2) + 8 ou
 * 9 dígitos) a partir de `numero` já normalizado — a Evolution e o operador
 * às vezes usam uma grafia, às vezes a outra (ASM-039). Números fora desse
 * padrão não geram variação: só o valor recebido.
 */
export function variantesNumero(numero: string): string[] {
  const variantes = new Set([numero]);

  if (/^55\d{10}$/.test(numero)) {
    variantes.add(`${numero.slice(0, 4)}9${numero.slice(4)}`);
  } else if (/^55\d{2}9\d{8}$/.test(numero)) {
    variantes.add(`${numero.slice(0, 4)}${numero.slice(5)}`);
  }

  return [...variantes];
}

/**
 * `true` quando `a` e `b` são o mesmo número — direto ou por uma das
 * variações do nono dígito (AC-149, AC-161). Espera dígitos já
 * normalizados (sem DDI ausente nem máscara).
 */
export function saoNumerosEquivalentes(a: string, b: string): boolean {
  return variantesNumero(a).includes(b);
}

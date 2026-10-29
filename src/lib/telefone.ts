// T-231 (fase5-acoes-rapidas, ASM-225): o telefone do lead (dígitos, como fica em `leads.telefone_e164`)
// no formato do link `tel:`; sem telefone, `null` — e o botão "Ligar" não aparece.
export function linkDeLigacao(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '');
  return digitos.length >= 10 ? `tel:+${digitos}` : null;
}

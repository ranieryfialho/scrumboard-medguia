// T-115 (fase3-etl-sheets, US-076): normalização de telefone e data brutos
// vindos das planilhas, antes de qualquer gravação no CRM.
//
// Telefone (AC-277): formatos como `p:+5511981665252`, `p:43996131309` e
// `092-991593737` chegam sem padrão — removemos prefixo e símbolos, tratamos
// o `0` de discagem nacional e assumimos +55 quando não há código de país
// (ASM-089). Número que não fecha em DDD (2) + número (8 ou 9 dígitos) é
// inválido e a função devolve `undefined` — quem chama decide que o lead
// migra sem telefone e vai para a fila de revisão.
//
// Data (AC-278): `created_time` chega em ISO com fuso (`-05:00`, `-03:00`) e
// `data_alteracao` chega em `dd/mm/aaaa, hh:mm:ss` no horário de Brasília
// (ASM-088, sem fuso explícito). Convertemos os dois formatos para o mesmo
// instante UTC, para que duas leituras do mesmo instante coincidam.

const FUSO_BRASILIA = '-03:00';

/** Remove o prefixo `p:` usado pela Meta e qualquer caractere que não seja dígito ou `+`. */
function limparTelefone(telefoneBruto: string): string {
  return telefoneBruto.trim().replace(/^p:/i, '');
}

/**
 * Normaliza um telefone bruto para E.164 (AC-277). Devolve `undefined`
 * quando o número é inválido ou incompleto — o lead correspondente migra
 * sem telefone e entra na fila de revisão (decisão de quem chama).
 */
export function normalizarTelefone(telefoneBruto: string | undefined | null): string | undefined {
  if (!telefoneBruto) return undefined;

  const semPrefixo = limparTelefone(telefoneBruto);
  const digitos = semPrefixo.replace(/\D/g, '');
  if (!digitos) return undefined;

  let numeroLocal: string;
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    // Já vem com código de país (+55).
    numeroLocal = digitos.slice(2);
  } else {
    let candidato = digitos;
    // Prefixo de discagem nacional (`0` + DDD + número) — ASM-089 assume Brasil.
    if (candidato.length === 12 && candidato.startsWith('0')) {
      candidato = candidato.slice(1);
    }
    numeroLocal = candidato;
  }

  // DDD (2 dígitos) + número de telefone (8 ou 9 dígitos) = 10 ou 11 dígitos.
  if (numeroLocal.length !== 10 && numeroLocal.length !== 11) {
    return undefined;
  }

  return `+55${numeroLocal}`;
}

const REGEX_DATA_ALTERACAO = /^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Normaliza uma data bruta (ISO com fuso ou `dd/mm/aaaa, hh:mm:ss` em
 * Brasília) para o instante UTC correspondente, em ISO 8601 (AC-278).
 * Devolve `undefined` quando a data é inválida.
 */
export function normalizarData(dataBruta: string | undefined | null): string | undefined {
  if (!dataBruta) return undefined;
  const valor = dataBruta.trim();
  if (!valor) return undefined;

  const match = valor.match(REGEX_DATA_ALTERACAO);
  if (match) {
    const [, dia, mes, ano, hora, minuto, segundo] = match;
    const isoComFuso = `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${FUSO_BRASILIA}`;
    const data = new Date(isoComFuso);
    if (Number.isNaN(data.getTime())) return undefined;
    return data.toISOString();
  }

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return undefined;
  return data.toISOString();
}

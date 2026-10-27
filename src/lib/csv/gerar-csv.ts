// T-179 (fase4-pipeline-lote, US-118, AC-458): gerador de CSV para o Excel em
// português — UTF-8 com BOM, ponto e vírgula como separador, quebra de linha
// CRLF, campos com `;`, aspas ou quebra de linha entre aspas (aspas duplicadas),
// e proteção contra injeção de fórmula: todo TEXTO que começaria com `=`, `+`,
// `-` ou `@` (ou tabulação/retorno) sai com um apóstrofo na frente, para a
// planilha nunca o executar. Número e data entram já formatados pelos auxiliares
// abaixo (ASM-155). Funções puras, sem dependência de banco.

const SEPARADOR = ';';
const BOM = '﻿';
const INICIOS_PERIGOSOS = /^[=+\-@\t\r]/;

export type CelulaCsv = string | number | Date | null | undefined;

/** Protege o texto contra interpretação como fórmula (OWASP "CSV injection"). */
export function neutralizarFormula(texto: string): string {
  return INICIOS_PERIGOSOS.test(texto) ? `'${texto}` : texto;
}

/** Valor em reais com vírgula decimal ("1234.5" → "1234,50"); vazio ou inválido vira texto vazio. */
export function formatarValorCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '';
  return numero.toFixed(2).replace('.', ',');
}

/**
 * Telefone brasileiro (E.164 `+55DDNNNNNNNNN`) no formato de leitura `(DD) NNNNN-NNNN`.
 * O `+` inicial do E.164 seria tratado como fórmula (com apóstrofo visível no Excel) e
 * os 13 dígitos virariam notação científica; a forma `(DD) …` é texto seguro e legível.
 * Número que não é brasileiro, ou fora do padrão, sai como veio (e `gerarCsv` o protege).
 */
export function formatarTelefoneCsv(telefone: string | null | undefined): string {
  if (!telefone) return '';
  const digitos = telefone.replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(digitos)) return telefone;
  const ddd = digitos.slice(2, 4);
  const numero = digitos.slice(4);
  const corte = numero.length === 9 ? 5 : 4;
  return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
}

/** dd/mm/aaaa hh:mm no fuso de São Paulo (o mesmo das telas). */
export function formatarDataHoraCsv(data: Date | null | undefined): string {
  if (!data) return '';
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', '');
}

function celulaParaTexto(celula: CelulaCsv): string {
  if (celula === null || celula === undefined) return '';
  if (celula instanceof Date) return formatarDataHoraCsv(celula);
  // Número entra com vírgula decimal e NUNCA é tratado como texto (não leva apóstrofo).
  if (typeof celula === 'number') return String(celula).replace('.', ',');
  return neutralizarFormula(celula);
}

function escaparCampo(texto: string): string {
  const precisaDeAspas = texto.includes(SEPARADOR) || texto.includes('"') || texto.includes('\n') || texto.includes('\r');
  return precisaDeAspas ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Monta o arquivo inteiro: BOM + cabeçalho + uma linha por registro, separados por CRLF. */
export function gerarCsv(colunas: readonly string[], linhas: ReadonlyArray<readonly CelulaCsv[]>): string {
  const cabecalho = colunas.map((coluna) => escaparCampo(coluna)).join(SEPARADOR);
  const corpo = linhas.map((linha) => linha.map((celula) => escaparCampo(celulaParaTexto(celula))).join(SEPARADOR));
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

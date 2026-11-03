// T-293 (fase4-card-abas, US-112, AC-750/AC-751): regras puras do dossiê de um card — como cada anexo se chama dentro do ZIP e o
// manifesto (CSV) que acompanha os arquivos. Sem I/O.

export const LIMITE_DOSSIE_BYTES = 100 * 1024 * 1024;

const EXTENSAO_POR_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** O nome do anexo como arquivo de ZIP: sem pasta, sem caractere de controle, sem ponto na frente, com no máximo 120 caracteres. */
export function nomeSeguroNoZip(nome: string | null, mime: string, id: string): string {
  const limpo = (nome ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return limpo || `anexo-${id.slice(0, 8)}.${EXTENSAO_POR_MIME[mime] ?? 'bin'}`;
}

/** Garante nomes únicos (sem diferenciar maiúsculas): o segundo "print.png" vira "print (2).png". */
export function nomesUnicos(nomes: string[]): string[] {
  const usados = new Set<string>();
  return nomes.map((nome) => {
    let candidato = nome;
    const ponto = nome.lastIndexOf('.');
    const base = ponto > 0 ? nome.slice(0, ponto) : nome;
    const extensao = ponto > 0 ? nome.slice(ponto) : '';
    for (let n = 2; usados.has(candidato.toLowerCase()); n++) candidato = `${base} (${n})${extensao}`;
    usados.add(candidato.toLowerCase());
    return candidato;
  });
}

export type IntegridadeDoAnexo = 'ok' | 'divergente' | 'ausente';

export interface LinhaDoManifesto {
  arquivo: string;
  nomeOriginal: string | null;
  tipo: string;
  tamanho: number;
  sha256: string;
  enviadoPor: string | null;
  enviadoEm: Date;
  evidencia: string | null;
  integridade: IntegridadeDoAnexo;
}

/** Texto de célula de CSV: aspas dobradas, e `=`, `+`, `-`, `@` no começo ganham uma `'` para o Excel não rodar como fórmula. */
function celula(valor: string | number | null): string {
  let texto = valor === null ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

const CABECALHO = ['arquivo', 'nome_original', 'tipo', 'tamanho_bytes', 'sha256', 'enviado_por', 'enviado_em_utc', 'evidencia_da_etapa', 'integridade'];

/** O `manifesto.csv`: UTF-8 com BOM (o Excel abre os acentos certos), uma linha por anexo, com o SHA-256 gravado no envio. */
export function montarManifesto(linhas: LinhaDoManifesto[]): string {
  const corpo = linhas.map((l) =>
    [l.arquivo, l.nomeOriginal, l.tipo, l.tamanho, l.sha256, l.enviadoPor, l.enviadoEm.toISOString(), l.evidencia, l.integridade].map(celula).join(',')
  );
  return `﻿${[CABECALHO.map(celula).join(','), ...corpo].join('\r\n')}\r\n`;
}

/** `dossie-clinica-santa-luzia-2026-11-03.zip`: o nome do lead sem acento nem símbolo. */
export function nomeDoArquivoDoDossie(leadNome: string, hoje: Date): string {
  const slug = leadNome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `dossie-${slug || 'card'}-${hoje.toISOString().slice(0, 10)}.zip`;
}

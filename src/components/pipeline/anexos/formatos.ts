// T-172 (fase4-card-abas, US-112): formatação dos dados de um anexo para a
// lista (nome, tamanho, data, hash). Funções puras, testadas pela própria tela.

export type TipoDoAnexo = 'pdf' | 'imagem';

export interface AnexoDaLista {
  id: string;
  /** Nome original (T-168); `null` nos anexos anteriores à migration 0013. */
  nome: string | null;
  mime: string;
  tamanho: number;
  hash: string;
  enviadoPorNome: string | null;
  criadoEm: string;
  evidencia: { etapaId: number; etapaNome: string } | null;
  /** T-294: o usuário pode excluir este anexo (gestor, ou quem o enviou). Ausente = não pode. */
  podeExcluir?: boolean;
}

export function tipoDoAnexo(mime: string): TipoDoAnexo {
  return mime === 'application/pdf' ? 'pdf' : 'imagem';
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** AC-428: o nome gravado ou, nos anexos antigos, "Anexo PDF — 27/10/2026 10:41" (tipo e data). */
export function nomeParaExibir(anexo: Pick<AnexoDaLista, 'nome' | 'mime' | 'criadoEm'>): string {
  if (anexo.nome) return anexo.nome;
  const rotulo = tipoDoAnexo(anexo.mime) === 'pdf' ? 'PDF' : 'Imagem';
  return `Anexo ${rotulo} — ${formatarDataHora(anexo.criadoEm)}`;
}

/** AC-424: início e fim do SHA-256 ("7f9a...3c21"). */
export function hashAbreviado(hash: string): string {
  return hash.length <= 10 ? hash : `${hash.slice(0, 4)}...${hash.slice(-4)}`;
}

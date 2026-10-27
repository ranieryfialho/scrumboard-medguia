// T-168 (fase4-card-abas, US-112): nome original do anexo (AC-428) — limpo
// só do que poderia vazar caminho do sistema de arquivos ou quebrar a UI;
// nunca decide onde o arquivo fica no disco (isso é `armazenamento.ts`).

const LIMITE_CARACTERES = 120;
// eslint-disable-next-line no-control-regex -- remover caracteres de controle é o próprio objetivo.
const CARACTERES_DE_CONTROLE = /[\x00-\x1f\x7f]/g;

/**
 * Nome original do arquivo para guardar e mostrar: só o último trecho do
 * caminho (sem pastas), sem caracteres de controle, até 120 caracteres;
 * vazio (ou só espaços/caminho) vira `null`.
 */
export function limparNomeArquivo(nomeOriginal: string): string | null {
  const semCaminho = nomeOriginal.split(/[/\\]/).pop() ?? '';
  const limpo = semCaminho.replace(CARACTERES_DE_CONTROLE, '').trim().slice(0, LIMITE_CARACTERES);
  return limpo.length > 0 ? limpo : null;
}

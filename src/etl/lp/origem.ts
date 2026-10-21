// T-121 (fase3-etl-lp, US-085): leitor somente leitura da LP via PostgREST.
//
// ASM-095: usa `SUPABASE_LP_URL` + `SUPABASE_LP_SERVICE_KEY` (chave de
// serviço, só em variável de ambiente — nunca hard-coded, P-002) porque a
// chave anônima aplica RLS e só enxerga 1 linha.
//
// AC-299 — `COLUNAS_SELECIONADAS` é a única lista de colunas pedida ao
// PostgREST e NUNCA inclui `password_hash`: como o `select=` é montado só
// a partir dessa lista, o hash nunca chega a entrar na memória do
// processo, então não há como ele vazar depois para relatório ou log —
// nem em simulação, porque este leitor não distingue modos.
//
// AC-306 — só existe função de leitura (GET) aqui; não há `inserir`,
// `atualizar` nem `excluir`. Erros nunca imprimem a chave crua — usam
// `mascarar` de `src/etl/comum.ts`.
import { mascarar } from '../comum';

export const VARIAVEL_AMBIENTE_URL = 'SUPABASE_LP_URL';
export const VARIAVEL_AMBIENTE_CHAVE = 'SUPABASE_LP_SERVICE_KEY';

/** Colunas explicitamente lidas da tabela `leads` da LP — NUNCA inclui `password_hash` (AC-299). */
export const COLUNAS_SELECIONADAS = [
  'id',
  'name',
  'email',
  'whatsapp',
  'especialidade',
  'crm',
  'anuncio',
  'status',
  'observacoes',
  'created_at',
  'data_alteracao',
  'data_fechamento',
  'termos_aceitos',
  'progresso_video',
] as const;

export interface CadastroLpBruto {
  id: number | string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  especialidade: string | null;
  crm: string | null;
  anuncio: string | null;
  status: string | null;
  observacoes: string | null;
  created_at: string | null;
  data_alteracao: string | null;
  data_fechamento: string | null;
  termos_aceitos: boolean | null;
  progresso_video: number | null;
}

export class ErroOrigemSemCredencial extends Error {
  constructor() {
    super(
      `${VARIAVEL_AMBIENTE_URL} e ${VARIAVEL_AMBIENTE_CHAVE} precisam estar definidas para ler a LP.`
    );
    this.name = 'ErroOrigemSemCredencial';
  }
}

export class ErroLeituraOrigem extends Error {
  constructor(status: number, chaveServico: string) {
    super(`Falha ao ler a LP (status ${status}) com a chave ${mascarar(chaveServico)}.`);
    this.name = 'ErroLeituraOrigem';
  }
}

export interface CredenciaisOrigemLp {
  url: string;
  chaveServico: string;
}

function lerCredenciais(credenciaisParam?: CredenciaisOrigemLp): CredenciaisOrigemLp {
  if (credenciaisParam) return credenciaisParam;
  const url = process.env[VARIAVEL_AMBIENTE_URL];
  const chaveServico = process.env[VARIAVEL_AMBIENTE_CHAVE];
  if (!url || !chaveServico) {
    throw new ErroOrigemSemCredencial();
  }
  return { url, chaveServico };
}

const TAMANHO_PAGINA_PADRAO = 500;

export interface ResultadoPaginaLp {
  linhas: CadastroLpBruto[];
  /** Total de linhas na tabela da LP, lido do header `Content-Range` (AC-304). */
  total: number;
}

type FuncaoFetch = typeof fetch;

function lerTotalDoContentRange(
  contentRange: string | null,
  offset: number,
  quantidadeLida: number
): number {
  if (!contentRange) return offset + quantidadeLida;
  const totalBruto = contentRange.split('/')[1];
  if (!totalBruto || totalBruto === '*') return offset + quantidadeLida;
  const total = Number(totalBruto);
  return Number.isFinite(total) ? total : offset + quantidadeLida;
}

/**
 * Lê uma página da tabela `leads` da LP via PostgREST, só com GET
 * (AC-306). `fetchImpl` é injetável para teste.
 */
export async function buscarPagina(
  offset: number,
  limite: number = TAMANHO_PAGINA_PADRAO,
  credenciaisParam?: CredenciaisOrigemLp,
  fetchImpl: FuncaoFetch = fetch
): Promise<ResultadoPaginaLp> {
  const credenciais = lerCredenciais(credenciaisParam);
  const select = COLUNAS_SELECIONADAS.join(',');
  const base = credenciais.url.replace(/\/$/, '');
  const url = `${base}/rest/v1/leads?select=${select}&order=id.asc&offset=${offset}&limit=${limite}`;

  const resposta = await fetchImpl(url, {
    method: 'GET',
    headers: {
      apikey: credenciais.chaveServico,
      Authorization: `Bearer ${credenciais.chaveServico}`,
      Prefer: 'count=exact',
    },
  });

  if (!resposta.ok) {
    throw new ErroLeituraOrigem(resposta.status, credenciais.chaveServico);
  }

  const linhas = (await resposta.json()) as CadastroLpBruto[];
  const total = lerTotalDoContentRange(resposta.headers.get('content-range'), offset, linhas.length);
  return { linhas, total };
}

/**
 * Lê toda a tabela `leads` da LP, paginando até o total do `Content-Range`
 * (AC-304: o relatório confere `lidas` com o total de linhas da origem).
 */
export async function lerTodosCadastros(
  credenciaisParam?: CredenciaisOrigemLp,
  fetchImpl: FuncaoFetch = fetch,
  tamanhoPagina: number = TAMANHO_PAGINA_PADRAO
): Promise<{ cadastros: CadastroLpBruto[]; total: number }> {
  const credenciais = lerCredenciais(credenciaisParam);
  const cadastros: CadastroLpBruto[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const pagina = await buscarPagina(offset, tamanhoPagina, credenciais, fetchImpl);
    cadastros.push(...pagina.linhas);
    total = pagina.total;
    if (pagina.linhas.length === 0) break;
    offset += pagina.linhas.length;
  }

  return { cadastros, total };
}

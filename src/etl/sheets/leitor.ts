// T-114 (fase3-etl-sheets, US-075): leitor somente leitura das abas de leads
// (AC-291 — nenhuma escrita: este módulo só expõe `spreadsheets.values.get`,
// com o escopo OAuth `spreadsheets.readonly`, nunca `.update`/`.append`/
// `.clear`). Reproduz as regras de leitura de coluna por aba de
// `src/app/api/sheets/route.ts` (cada planilha/aba nomeia as colunas de um
// jeito diferente — AC-273) e descarta, contando, o lead de teste da Meta
// e linhas em branco (AC-274) antes de virarem lead.
import { google, sheets_v4 } from 'googleapis';

/** Único escopo usado para acessar o Google Sheets — somente leitura (ASM-094, AC-291). */
export const ESCOPO_SOMENTE_LEITURA = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Chave `planilha/aba` reconhecida — mesmas quatro abas de leads do legado. */
export type ChaveAbaConhecida =
  | 'sheet1/Página1'
  | 'sheet1/Página2'
  | 'sheet2/Página1'
  | 'sheet3/Página1';

export interface LeadBruto {
  /** Posição da linha de dados na aba (0 = primeira linha após o cabeçalho). */
  linha: number;
  /** Id da Meta (coluna `id`), chave única do lead (ASM-090). Vazio se a aba não tiver essa coluna. */
  metaId: string;
  nome: string;
  especialidade: string;
  telefone: string;
  email: string;
  /** Status bruto da planilha, antes de qualquer tradução (T-117 cuida disso). */
  situacaoBruta: string;
  /** Todas as colunas da linha, com o cabeçalho normalizado (minúsculo, sem acento) — usado pelas próximas etapas (origem, anúncio, campanha, observações etc.). */
  camposExtras: Record<string, string>;
}

export type MotivoIgnorado = 'lead_de_teste' | 'linha_em_branco';

export interface LinhaIgnorada {
  linha: number;
  motivo: MotivoIgnorado;
}

export interface ResultadoLeituraAba {
  aba: string;
  /** Quantidade de linhas de dados (exclui o cabeçalho) — usada depois para conferir a contagem do relatório (AC-292). */
  linhasLidas: number;
  leads: LeadBruto[];
  ignoradas: LinhaIgnorada[];
}

function normalizarCabecalho(valor: string | undefined): string {
  if (!valor) return '';
  return valor
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Nome e especialidade são lidos de colunas diferentes em cada aba (AC-273)
 * — mesma regra de `fetchSheetData` no legado, inclusive a peculiaridade de
 * `sheet1/Página1`: a coluna `full_name` dessa aba carrega a especialidade,
 * não o nome.
 */
function lerNomeEEspecialidade(
  aba: string,
  campos: Record<string, string>
): { nome: string; especialidade: string } {
  if (aba === 'sheet1/Página1') {
    return {
      nome: campos['company_name'] || campos['cargo'] || campos['nome'] || '',
      especialidade: campos['full_name'] || campos['cargo'] || '',
    };
  }
  if (aba === 'sheet1/Página2' || aba === 'sheet2/Página1') {
    return {
      nome: campos['first name'] || campos['first_name'] || '',
      especialidade: campos['qual_a_sua_especialidade?'] || campos['qual_a_sua_especialidade'] || '',
    };
  }
  if (aba === 'sheet3/Página1') {
    return {
      nome: campos['full name'] || campos['full_name'] || '',
      especialidade:
        campos['qual_a_sua_especialidade_medica?'] || campos['qual_a_sua_especialidade_medica'] || '',
    };
  }
  return {
    nome:
      campos['full_name'] ||
      campos['full name'] ||
      campos['first_name'] ||
      campos['first name'] ||
      campos['company_name'] ||
      campos['nome'] ||
      '',
    especialidade:
      campos['qual_a_sua_especialidade_medica?'] ||
      campos['qual_a_sua_especialidade_medica'] ||
      campos['qual_a_sua_especialidade?'] ||
      campos['qual_a_sua_especialidade'] ||
      campos['company_name'] ||
      campos['cargo'] ||
      '',
  };
}

function lerTelefone(campos: Record<string, string>): string {
  return (
    campos['phone_number'] ||
    campos['telefone'] ||
    campos['qual_seu_numero_de_whatsapp?'] ||
    campos['qual_seu_numero_de_whatsapp'] ||
    campos['qual_seu_numero'] ||
    campos['whatsapp'] ||
    ''
  );
}

/** Lead de teste da Meta (AC-274): `is_organic = true` ou nome contendo "dummy data". */
function ehLeadDeTeste(campos: Record<string, string>, nomeBruto: string): boolean {
  const isOrganic = (campos['is_organic'] ?? '').trim().toLowerCase();
  if (isOrganic === 'true') return true;
  return nomeBruto.trim().toLowerCase().includes('dummy data');
}

/** Linha sem nenhum dado de lead, só com status preenchido (AC-274). */
function ehLinhaEmBranco(nome: string, especialidade: string, telefone: string, email: string): boolean {
  return !nome.trim() && !especialidade.trim() && !telefone.trim() && !email.trim();
}

/**
 * Lê uma aba já baixada (header na primeira linha) e separa leads válidos de
 * linhas ignoradas, contando o motivo de cada uma (AC-273, AC-274). Função
 * pura — não acessa a rede; quem busca as linhas é `buscarLinhasAba`.
 */
export function lerAba(aba: string, linhas: string[][]): ResultadoLeituraAba {
  if (linhas.length === 0) {
    return { aba, linhasLidas: 0, leads: [], ignoradas: [] };
  }

  const cabecalhos = linhas[0].map(normalizarCabecalho);
  const linhasDeDados = linhas.slice(1);

  const leads: LeadBruto[] = [];
  const ignoradas: LinhaIgnorada[] = [];

  linhasDeDados.forEach((linha, indice) => {
    const campos: Record<string, string> = {};
    cabecalhos.forEach((cabecalho, colIndex) => {
      if (!cabecalho) return;
      campos[cabecalho] = (linha[colIndex] ?? '').toString();
    });

    const metaId = campos['id'] ?? '';
    const { nome, especialidade } = lerNomeEEspecialidade(aba, campos);
    const telefone = lerTelefone(campos);
    const email = campos['email'] || '';
    const situacaoBruta = campos['lead_status'] || campos['situacao'] || '';

    if (ehLeadDeTeste(campos, nome)) {
      ignoradas.push({ linha: indice, motivo: 'lead_de_teste' });
      return;
    }

    if (ehLinhaEmBranco(nome, especialidade, telefone, email)) {
      ignoradas.push({ linha: indice, motivo: 'linha_em_branco' });
      return;
    }

    leads.push({
      linha: indice,
      metaId,
      nome: nome || 'Sem Nome',
      especialidade,
      telefone,
      email,
      situacaoBruta,
      camposExtras: campos,
    });
  });

  return { aba, linhasLidas: linhasDeDados.length, leads, ignoradas };
}

export interface CredenciaisContaDeServico {
  email: string;
  chavePrivada: string;
}

/**
 * Cliente autenticado só com `spreadsheets.readonly` (AC-291, ASM-094) — este
 * módulo nunca solicita o escopo de escrita, então não há como uma chamada
 * daqui alterar a planilha.
 */
export function criarClienteSheetsSomenteLeitura(credenciais: CredenciaisContaDeServico): sheets_v4.Sheets {
  const auth = new google.auth.JWT({
    email: credenciais.email,
    key: credenciais.chavePrivada,
    scopes: [ESCOPO_SOMENTE_LEITURA],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Busca as linhas brutas de uma aba via `values.get` (leitura pura, AC-291). */
export async function buscarLinhasAba(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rangeName: string
): Promise<string[][]> {
  const resposta = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeName });
  return (resposta.data.values as string[][] | undefined) ?? [];
}

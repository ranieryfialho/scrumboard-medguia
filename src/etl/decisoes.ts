// T-124 (fase3-etl-decisoes, US-086/US-088): planilha de decisões e
// validador comuns aos três ETLs (Supabase, Sheets, LP — ASM-101). A
// simulação de qualquer um deles gera a fila de revisão nesta mesma planilha
// (AC-307), a operação devolve o arquivo preenchido, e `validarDecisao`
// decide se cada linha vira etapa, ignora o lead ou volta para a revisão
// (AC-312/AC-313/AC-314) — sempre lendo as exigências de cada etapa dos
// dados recebidos (`exigeProximaAcao`/`exigeValor`/`exigeMotivo`), nunca de
// ids fixos no código (essa regra é dos ETLs, não daqui).
//
// Formato do arquivo (AC-308): UTF-8 com BOM, separador `;`, aspas RFC 4180
// — o Excel só reconhece a codificação de um CSV como UTF-8 com o BOM
// presente, e abre `;` como separador de coluna por padrão em locales
// pt-BR (onde `,` é separador decimal); o Google Sheets lê os dois formatos
// sem diferença.

const BOM = '﻿';
const SEPARADOR = ';';
const QUEBRA_LINHA = '\r\n';

/** Colunas, nesta ordem, na planilha de fila de revisão / decisões (AC-307). */
const CABECALHO = [
  'id_origem',
  'nome',
  'telefone',
  'email',
  'status_original',
  'motivo_revisao',
  'etapa',
  'proxima_acao',
  'valor',
  'motivo_perda',
  'ignorar',
] as const;

/** Um lead da fila de revisão, antes da operação preencher a decisão (AC-307). */
export interface ItemFilaRevisao {
  idOrigem: string;
  nome: string;
  telefone: string;
  email: string;
  statusOriginal: string;
  motivoRevisao: string;
}

/** Uma linha da planilha de decisões, já lida de volta — sem nenhuma interpretação ainda. */
export interface LinhaDecisaoBruta {
  idOrigem: string;
  etapa: string;
  proximaAcao: string;
  valor: string;
  motivoPerda: string;
  ignorar: string;
}

function precisaCitar(campo: string): boolean {
  return campo.includes(SEPARADOR) || campo.includes('"') || campo.includes('\n') || campo.includes('\r');
}

/** Aspas RFC 4180: cita o campo e dobra toda aspa interna. */
function citarCampo(valor: string): string {
  const campo = valor ?? '';
  if (!precisaCitar(campo)) return campo;
  return `"${campo.replace(/"/g, '""')}"`;
}

function linhaCsv(campos: string[]): string {
  return campos.map(citarCampo).join(SEPARADOR);
}

/**
 * Gera a planilha da fila de revisão (AC-307): uma linha por lead, com as
 * colunas descritivas preenchidas e as colunas de decisão em branco para a
 * operação preencher. UTF-8 com BOM e separador `;` (AC-308).
 */
export function gerarCsvFilaRevisao(itens: ItemFilaRevisao[]): string {
  const linhas = [linhaCsv([...CABECALHO])];
  for (const item of itens) {
    linhas.push(
      linhaCsv([item.idOrigem, item.nome, item.telefone, item.email, item.statusOriginal, item.motivoRevisao, '', '', '', '', ''])
    );
  }
  return BOM + linhas.join(QUEBRA_LINHA) + QUEBRA_LINHA;
}

/** Quebra uma linha de CSV (já sem a quebra de linha final) respeitando aspas RFC 4180. */
function dividirLinhaCsv(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        atual += c;
      }
      continue;
    }
    if (c === '"') {
      dentroDeAspas = true;
      continue;
    }
    if (c === SEPARADOR) {
      campos.push(atual);
      atual = '';
      continue;
    }
    atual += c;
  }
  campos.push(atual);
  return campos;
}

/** Separa o texto do arquivo em registros CSV, juntando linhas quebradas por uma aspa aberta (RFC 4180). */
function dividirRegistrosCsv(texto: string): string[] {
  const linhasBrutas = texto.split(/\r\n|\n|\r/);
  const registros: string[] = [];
  let pendente: string | null = null;
  for (const linha of linhasBrutas) {
    const acumulada: string = pendente === null ? linha : `${pendente}\n${linha}`;
    const aspas = (acumulada.match(/"/g) ?? []).length;
    if (aspas % 2 !== 0) {
      pendente = acumulada;
    } else {
      registros.push(acumulada);
      pendente = null;
    }
  }
  if (pendente !== null) registros.push(pendente);
  return registros;
}

/**
 * Lê de volta a planilha de decisões (AC-308): remove o BOM, separa por
 * `;` com aspas RFC 4180, e casa cada coluna pelo nome do cabeçalho — não
 * pela posição, para não quebrar se a operação reordenar colunas na planilha.
 */
export function lerCsvDecisoes(texto: string): LinhaDecisaoBruta[] {
  const semBom = texto.startsWith(BOM) ? texto.slice(BOM.length) : texto;
  const registros = dividirRegistrosCsv(semBom).filter((registro) => registro.length > 0);
  if (registros.length === 0) return [];

  const cabecalho = dividirLinhaCsv(registros[0]).map((campo) => campo.trim().toLowerCase());
  const indice = (nome: string): number => cabecalho.indexOf(nome);

  const iIdOrigem = indice('id_origem');
  const iEtapa = indice('etapa');
  const iProximaAcao = indice('proxima_acao');
  const iValor = indice('valor');
  const iMotivoPerda = indice('motivo_perda');
  const iIgnorar = indice('ignorar');

  const campo = (campos: string[], i: number): string => (i < 0 ? '' : (campos[i] ?? '').trim());

  return registros.slice(1).map((registro) => {
    const campos = dividirLinhaCsv(registro);
    return {
      idOrigem: campo(campos, iIdOrigem),
      etapa: campo(campos, iEtapa),
      proximaAcao: campo(campos, iProximaAcao),
      valor: campo(campos, iValor),
      motivoPerda: campo(campos, iMotivoPerda),
      ignorar: campo(campos, iIgnorar),
    };
  });
}

/** Etapa do pipeline, só com o que o validador precisa saber dela (lido da tabela `etapas`, nunca fixo aqui). */
export interface EtapaValidacao {
  id: number;
  nome: string;
  exigeProximaAcao: boolean;
  exigeValor: boolean;
  exigeMotivo: boolean;
}

/** Motivo de perda, só com o que o validador precisa saber dele. */
export interface MotivoPerdaValidacao {
  id: string;
  nome: string;
}

export interface OpcoesValidacao {
  etapas: EtapaValidacao[];
  motivosPerda: MotivoPerdaValidacao[];
  /** Instante da execução — próxima ação igual ou anterior a este instante volta para a revisão (AC-313). */
  agora: Date;
}

export type ResultadoValidacao =
  | { tipo: 'etapa'; etapaId: number; proximaAcaoEm?: Date; valor?: number; motivoPerdaId?: string }
  | { tipo: 'ignorar' }
  | { tipo: 'recusada'; motivo: string };

const VALORES_IGNORAR_VERDADEIRO = new Set(['sim', 's', 'true', '1', 'x']);

function normalizarChave(valor: string): string {
  return valor
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function ehIgnorar(valor: string): boolean {
  return VALORES_IGNORAR_VERDADEIRO.has(normalizarChave(valor));
}

/** Acha a etapa pelo nome (sem acento/maiúsculas) ou pelo número do id. */
function encontrarEtapa(valor: string, etapas: EtapaValidacao[]): EtapaValidacao | undefined {
  const bruto = valor.trim();
  if (bruto === '') return undefined;
  if (/^\d+$/.test(bruto)) {
    const id = Number(bruto);
    return etapas.find((e) => e.id === id);
  }
  const chave = normalizarChave(bruto);
  return etapas.find((e) => normalizarChave(e.nome) === chave);
}

function encontrarMotivoPerda(valor: string, motivos: MotivoPerdaValidacao[]): MotivoPerdaValidacao | undefined {
  const chave = normalizarChave(valor);
  return motivos.find((m) => normalizarChave(m.nome) === chave);
}

/**
 * `dd/mm/aaaa hh:mm` (ou só `dd/mm/aaaa`, às 09:00) no horário de Brasília,
 * fixo em UTC-3 (ASM-106 — Brasil não observa horário de verão desde 2019).
 * Devolve `undefined` quando o formato não é esse.
 */
function interpretarData(valor: string): Date | undefined {
  const bruto = valor.trim();
  const comHora = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  const soData = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const m = comHora ?? soData;
  if (!m) return undefined;

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const hora = comHora ? Number(m[4]) : 9;
  const minuto = comHora ? Number(m[5]) : 0;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return undefined;

  // Horário de Brasília = UTC-3: o instante UTC equivalente soma 3 horas ao horário local.
  const data = new Date(Date.UTC(ano, mes - 1, dia, hora + 3, minuto, 0));
  if (Number.isNaN(data.getTime())) return undefined;
  // Rejeita datas "estouradas" (ex.: 31/02) que o `Date` rolaria para o mês seguinte.
  const verificacao = new Date(Date.UTC(ano, mes - 1, dia));
  if (verificacao.getUTCMonth() !== mes - 1 || verificacao.getUTCDate() !== dia) return undefined;
  return data;
}

/** `1.234,56` (pt-BR: ponto de milhar, vírgula decimal) — `undefined` quando não dá para ler. */
function interpretarValor(valor: string): number | undefined {
  const bruto = valor.trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(bruto)) return undefined;
  const numero = Number(bruto.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numero)) return undefined;
  return numero;
}

/**
 * Valida uma linha de decisão (AC-312/AC-313/AC-314): resolve a etapa (por
 * nome ou número), checa as exigências dela — lidas de `etapas`, nunca
 * fixas aqui — e a data de próxima ação vencida. Qualquer problema devolve
 * `'recusada'` com o motivo; nunca lança.
 */
export function validarDecisao(linha: LinhaDecisaoBruta, opcoes: OpcoesValidacao): ResultadoValidacao {
  const etapaPreenchida = linha.etapa.trim() !== '';
  const ignorarMarcado = ehIgnorar(linha.ignorar);

  if (etapaPreenchida && ignorarMarcado) {
    return { tipo: 'recusada', motivo: 'etapa e ignorar preenchidos ao mesmo tempo' };
  }
  if (ignorarMarcado) {
    return { tipo: 'ignorar' };
  }
  if (!etapaPreenchida) {
    return { tipo: 'recusada', motivo: 'linha sem etapa e sem marcação de ignorar' };
  }

  const etapa = encontrarEtapa(linha.etapa, opcoes.etapas);
  if (!etapa) {
    return { tipo: 'recusada', motivo: `etapa desconhecida: "${linha.etapa.trim()}"` };
  }

  let proximaAcaoEm: Date | undefined;
  if (etapa.exigeProximaAcao) {
    if (linha.proximaAcao.trim() === '') {
      return { tipo: 'recusada', motivo: `falta próxima ação, exigida pela etapa "${etapa.nome}"` };
    }
    const data = interpretarData(linha.proximaAcao);
    if (!data) {
      return { tipo: 'recusada', motivo: `data de próxima ação não dá para ler: "${linha.proximaAcao.trim()}"` };
    }
    if (data.getTime() <= opcoes.agora.getTime()) {
      return { tipo: 'recusada', motivo: 'data de próxima ação já passou' };
    }
    proximaAcaoEm = data;
  }

  let valorNumerico: number | undefined;
  if (etapa.exigeValor) {
    if (linha.valor.trim() === '') {
      return { tipo: 'recusada', motivo: `falta valor, exigido pela etapa "${etapa.nome}"` };
    }
    const numero = interpretarValor(linha.valor);
    if (numero === undefined) {
      return { tipo: 'recusada', motivo: `valor não dá para ler: "${linha.valor.trim()}"` };
    }
    valorNumerico = numero;
  }

  let motivoPerdaId: string | undefined;
  if (etapa.exigeMotivo) {
    if (linha.motivoPerda.trim() === '') {
      return { tipo: 'recusada', motivo: `falta motivo de perda, exigido pela etapa "${etapa.nome}"` };
    }
    const motivo = encontrarMotivoPerda(linha.motivoPerda, opcoes.motivosPerda);
    if (!motivo) {
      return { tipo: 'recusada', motivo: `motivo de perda desconhecido: "${linha.motivoPerda.trim()}"` };
    }
    motivoPerdaId = motivo.id;
  }

  return {
    tipo: 'etapa',
    etapaId: etapa.id,
    ...(proximaAcaoEm ? { proximaAcaoEm } : {}),
    ...(valorNumerico !== undefined ? { valor: valorNumerico } : {}),
    ...(motivoPerdaId ? { motivoPerdaId } : {}),
  };
}

/**
 * Linhas de decisão cujo `idOrigem` não está na fila (AC-314, segunda
 * parte): o chamador (ETL de cada origem) usa isso para listar no relatório
 * sem criar nada — esta função só identifica, não decide o que fazer.
 */
export function linhasDecisaoForaDaFila(idsNaFila: Iterable<string>, linhas: LinhaDecisaoBruta[]): LinhaDecisaoBruta[] {
  const idsConhecidos = new Set(idsNaFila);
  return linhas.filter((linha) => !idsConhecidos.has(linha.idOrigem));
}

// T-289 (fase4-card-abas, US-114, AC-742/AC-743): dados comerciais do card — "Dados da Proposta" (previsão de fechamento, condição
// especial, plano) e "Qualificação Técnica" (porte da clínica, prontuário legado, faturamento TISS, termo LGPD). Uma linha por
// oportunidade em `oportunidade_comercial`, criada na primeira edição. Só grava o que mudou e registra o que mudou como evento
// `edicao_card` (o mesmo de `edicao-card.ts`) na linha do tempo.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { oportunidadeComercial, oportunidadeEventos, oportunidades } from '../db/schema';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';
import { TIPO_EVENTO_EDICAO_CARD, ErroCardNaoEncontrado, type Alteracao, type CampoComercialRegistrado } from './edicao-card';

export type CampoComercial =
  | 'previsaoFechamento'
  | 'condicaoEspecial'
  | 'plano'
  | 'porteClinica'
  | 'prontuarioLegado'
  | 'faturamentoTiss'
  | 'termoLgpdValidado';

export interface DadosComerciais {
  previsaoFechamento: string | null;
  condicaoEspecial: string | null;
  plano: string | null;
  porteClinica: string | null;
  prontuarioLegado: string | null;
  faturamentoTiss: string | null;
  termoLgpdValidado: boolean;
}

export const DADOS_COMERCIAIS_VAZIOS: DadosComerciais = {
  previsaoFechamento: null,
  condicaoEspecial: null,
  plano: null,
  porteClinica: null,
  prontuarioLegado: null,
  faturamentoTiss: null,
  termoLgpdValidado: false,
};

/** Um campo veio mal formado (400, com o campo). */
export class ErroCampoComercialInvalido extends Error {
  constructor(public readonly campo: CampoComercial) {
    super(`Campo inválido: ${campo}`);
    this.name = 'ErroCampoComercialInvalido';
  }
}

const TEXTOS: CampoComercial[] = ['condicaoEspecial', 'plano', 'porteClinica', 'prontuarioLegado', 'faturamentoTiss'];
const TEXTO_MAX = 200;

function textoOuNulo(valor: unknown, campo: CampoComercial): string | null {
  if (valor === null) return null;
  if (typeof valor !== 'string') throw new ErroCampoComercialInvalido(campo);
  const aparado = valor.trim();
  if (aparado.length > TEXTO_MAX) throw new ErroCampoComercialInvalido(campo);
  return aparado === '' ? null : aparado;
}

/** `AAAA-MM-DD` de um dia que existe (31/02 não passa), ou `null` para limpar. */
function dataOuNula(valor: unknown): string | null {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new ErroCampoComercialInvalido('previsaoFechamento');
  const data = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor) throw new ErroCampoComercialInvalido('previsaoFechamento');
  return valor;
}

function daLinha(linha: typeof oportunidadeComercial.$inferSelect | undefined): DadosComerciais {
  if (!linha) return { ...DADOS_COMERCIAIS_VAZIOS };
  return {
    previsaoFechamento: linha.previsaoFechamento,
    condicaoEspecial: linha.condicaoEspecial,
    plano: linha.plano,
    porteClinica: linha.porteClinica,
    prontuarioLegado: linha.prontuarioLegado,
    faturamentoTiss: linha.faturamentoTiss,
    termoLgpdValidado: linha.termoLgpdValidado,
  };
}

/** AC-742: os dados comerciais do card (tudo vazio e termo "não" quando ninguém preencheu ainda). */
export async function lerDadosComerciais(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string): Promise<DadosComerciais> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select()
      .from(oportunidadeComercial)
      .where(and(eq(oportunidadeComercial.oportunidadeId, oportunidadeId), eq(oportunidadeComercial.empresaId, contexto.empresaId)))
      .limit(1);
    return daLinha(linha);
  });
}

const ROTULO: Record<CampoComercial, CampoComercialRegistrado> = {
  previsaoFechamento: 'previsao_fechamento',
  condicaoEspecial: 'condicao_especial',
  plano: 'plano',
  porteClinica: 'porte_clinica',
  prontuarioLegado: 'prontuario_legado',
  faturamentoTiss: 'faturamento_tiss',
  termoLgpdValidado: 'termo_lgpd',
};

/** AC-742/AC-743: aplica só os campos informados que mudaram; devolve o que mudou e os dados já atualizados. */
export async function editarDadosComerciais(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  entrada: Partial<Record<CampoComercial, unknown>>
): Promise<{ alteracoes: Alteracao[]; dados: DadosComerciais }> {
  const novos: Partial<DadosComerciais> = {};
  if (entrada.previsaoFechamento !== undefined) novos.previsaoFechamento = dataOuNula(entrada.previsaoFechamento);
  for (const campo of TEXTOS) {
    if (entrada[campo] !== undefined) (novos as Record<string, string | null>)[campo] = textoOuNulo(entrada[campo], campo);
  }
  if (entrada.termoLgpdValidado !== undefined) {
    if (typeof entrada.termoLgpdValidado !== 'boolean') throw new ErroCampoComercialInvalido('termoLgpdValidado');
    novos.termoLgpdValidado = entrada.termoLgpdValidado;
  }

  return comTenant(db, contexto, async (tx) => {
    const [op] = await tx
      .select({ id: oportunidades.id })
      .from(oportunidades)
      .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    if (!op) throw new ErroCardNaoEncontrado();

    const [existente] = await tx
      .select()
      .from(oportunidadeComercial)
      .where(and(eq(oportunidadeComercial.oportunidadeId, oportunidadeId), eq(oportunidadeComercial.empresaId, contexto.empresaId)))
      .limit(1);
    const atuais = daLinha(existente);

    const alteracoes: Alteracao[] = [];
    for (const campo of Object.keys(novos) as CampoComercial[]) {
      if (atuais[campo] === novos[campo]) continue;
      const texto = (v: unknown) => (typeof v === 'boolean' ? (v ? 'sim' : 'não') : (v as string | null));
      alteracoes.push({ campo: ROTULO[campo], de: texto(atuais[campo]), para: texto(novos[campo]) });
    }
    if (alteracoes.length === 0) return { alteracoes, dados: atuais };

    const dados: DadosComerciais = { ...atuais, ...novos };
    await tx
      .insert(oportunidadeComercial)
      .values({ oportunidadeId, empresaId: contexto.empresaId, ...dados, atualizadoPor: contexto.usuarioId })
      .onConflictDoUpdate({
        target: oportunidadeComercial.oportunidadeId,
        set: { ...dados, atualizadoEm: new Date(), atualizadoPor: contexto.usuarioId },
      });
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId,
      tipo: TIPO_EVENTO_EDICAO_CARD,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { alteracoes },
    });
    return { alteracoes, dados };
  });
}

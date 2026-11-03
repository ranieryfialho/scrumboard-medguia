// T-287 (fase4-pipeline-telas, US-109, AC-736/AC-737): edita os dados do card pelo detalhe — nome, e-mail, origem e telefone
// principal (tabela `leads`) e valor estimado (tabela `oportunidades`) — numa transação só, e registra o que mudou como um
// evento `edicao_card` na linha do tempo (mesmo log append-only de `anotacao`; `tipo` é texto livre, ASM-139). Só grava o que
// mudou de fato; sem mudança nenhuma, nada é gravado nem registrado.
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { leads, oportunidadeEventos, oportunidades } from '../db/schema';
import { normalizarNumero, variantesNumero } from '../domain/whatsapp/numero';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export const TIPO_EVENTO_EDICAO_CARD = 'edicao_card';
const ETAPA_PROPOSTA = 11;

export type CampoEditavel = 'nome' | 'email' | 'origem' | 'telefone' | 'valor';
/** T-289: campos dos dados comerciais (`dados-comerciais.ts`) que entram no mesmo evento `edicao_card`. */
export type CampoComercialRegistrado =
  | 'previsao_fechamento'
  | 'condicao_especial'
  | 'plano'
  | 'porte_clinica'
  | 'prontuario_legado'
  | 'faturamento_tiss'
  | 'termo_lgpd';

export interface DadosEdicaoCard {
  nome?: unknown;
  email?: unknown;
  origem?: unknown;
  telefone?: unknown;
  valor?: unknown;
}

export interface Alteracao {
  campo: CampoEditavel | CampoComercialRegistrado;
  de: string | null;
  para: string | null;
}

/** Um campo veio vazio ou mal formado (400, com o campo). */
export class ErroCampoInvalido extends Error {
  constructor(public readonly campo: CampoEditavel) {
    super(`Campo inválido: ${campo}`);
    this.name = 'ErroCampoInvalido';
  }
}

/** O card não existe nesta empresa (404). */
export class ErroCardNaoEncontrado extends Error {
  constructor() {
    super('Card não encontrado.');
    this.name = 'ErroCardNaoEncontrado';
  }
}

/** O telefone novo já é de outro lead da mesma empresa (409). */
export class ErroTelefoneDeOutroLead extends Error {
  constructor() {
    super('Esse telefone já pertence a outro lead.');
    this.name = 'ErroTelefoneDeOutroLead';
  }
}

/** Na etapa Proposta o valor é obrigatório e maior que zero (`oportunidades_proposta_exige_valor`). */
export class ErroValorObrigatorioNaProposta extends Error {
  constructor() {
    super('Na etapa Proposta o valor estimado é obrigatório.');
    this.name = 'ErroValorObrigatorioNaProposta';
  }
}

function texto(valor: unknown, campo: CampoEditavel, max: number, obrigatorio: boolean): string | null {
  if (typeof valor !== 'string') throw new ErroCampoInvalido(campo);
  const aparado = valor.trim();
  if (aparado.length === 0) {
    if (obrigatorio) throw new ErroCampoInvalido(campo);
    return null;
  }
  if (aparado.length > max) throw new ErroCampoInvalido(campo);
  return aparado;
}

function valorEmReais(valor: unknown): string | null {
  if (valor === null || valor === '') return null;
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.replace(',', '.')) : NaN;
  if (!Number.isFinite(numero) || numero < 0 || numero >= 1e10) throw new ErroCampoInvalido('valor');
  return numero.toFixed(2);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** AC-736/AC-737: aplica só os campos informados que mudaram; devolve a lista do que mudou (vazia = nada gravado). */
export async function editarCard(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  dados: DadosEdicaoCard
): Promise<Alteracao[]> {
  const novoLead: Partial<Record<'nome' | 'email' | 'origem' | 'telefoneE164', string | null>> = {};
  if (dados.nome !== undefined) novoLead.nome = texto(dados.nome, 'nome', 200, true);
  if (dados.origem !== undefined) novoLead.origem = texto(dados.origem, 'origem', 100, true);
  if (dados.email !== undefined) {
    const email = texto(dados.email, 'email', 200, false);
    if (email && !EMAIL.test(email)) throw new ErroCampoInvalido('email');
    novoLead.email = email;
  }
  if (dados.telefone !== undefined) {
    const bruto = texto(dados.telefone, 'telefone', 40, true);
    const numero = bruto ? normalizarNumero(bruto) : null;
    if (!numero) throw new ErroCampoInvalido('telefone');
    novoLead.telefoneE164 = numero;
  }
  const novoValor = dados.valor !== undefined ? valorEmReais(dados.valor) : undefined;

  return comTenant(db, contexto, async (tx) => {
    const [op] = await tx
      .select({ leadId: oportunidades.leadId, etapaId: oportunidades.etapaId, valor: oportunidades.valor })
      .from(oportunidades)
      .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);
    if (!op) throw new ErroCardNaoEncontrado();
    const [lead] = await tx
      .select({ nome: leads.nome, email: leads.email, origem: leads.origem, telefoneE164: leads.telefoneE164 })
      .from(leads)
      .where(and(eq(leads.id, op.leadId), eq(leads.empresaId, contexto.empresaId)))
      .limit(1);

    const alteracoes: Alteracao[] = [];
    const mudancasLead: Partial<typeof novoLead> = {};
    const rotulos = { nome: 'nome', email: 'email', origem: 'origem', telefoneE164: 'telefone' } as const;
    for (const chave of ['nome', 'email', 'origem', 'telefoneE164'] as const) {
      if (!(chave in novoLead)) continue;
      const atual = lead[chave] ?? null;
      const novo = novoLead[chave] ?? null;
      // Telefones antigos podem estar com "+" ou máscara: o mesmo número em outra grafia não é mudança.
      const atualComparavel = chave === 'telefoneE164' && atual ? normalizarNumero(atual) : atual;
      if (atualComparavel === novo) continue;
      mudancasLead[chave] = novo;
      alteracoes.push({ campo: rotulos[chave], de: atual, para: novo });
    }

    if (mudancasLead.telefoneE164) {
      const outros = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.empresaId, contexto.empresaId),
            ne(leads.id, op.leadId),
            inArray(leads.telefoneE164, variantesNumero(mudancasLead.telefoneE164))
          )
        )
        .limit(1);
      if (outros.length > 0) throw new ErroTelefoneDeOutroLead();
    }

    const valorAtual = op.valor === null ? null : Number(op.valor).toFixed(2);
    const mudouValor = novoValor !== undefined && novoValor !== valorAtual;
    if (mudouValor) {
      if (op.etapaId === ETAPA_PROPOSTA && (novoValor === null || Number(novoValor) <= 0)) {
        throw new ErroValorObrigatorioNaProposta();
      }
      alteracoes.push({ campo: 'valor', de: valorAtual, para: novoValor ?? null });
    }

    if (alteracoes.length === 0) return [];

    if (Object.keys(mudancasLead).length > 0) {
      await tx
        .update(leads)
        .set({
          ...(mudancasLead.nome ? { nome: mudancasLead.nome } : {}),
          ...(mudancasLead.origem !== undefined ? { origem: mudancasLead.origem } : {}),
          ...(mudancasLead.email !== undefined ? { email: mudancasLead.email } : {}),
          ...(mudancasLead.telefoneE164 ? { telefoneE164: mudancasLead.telefoneE164 } : {}),
          atualizadoEm: new Date(),
        })
        .where(and(eq(leads.id, op.leadId), eq(leads.empresaId, contexto.empresaId)));
    }
    if (mudouValor) {
      await tx
        .update(oportunidades)
        .set({ valor: novoValor ?? null, atualizadoEm: new Date() })
        .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)));
    }
    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId,
      tipo: TIPO_EVENTO_EDICAO_CARD,
      atorId: contexto.usuarioId,
      atorTipo: 'usuario',
      payload: { alteracoes },
    });
    return alteracoes;
  });
}

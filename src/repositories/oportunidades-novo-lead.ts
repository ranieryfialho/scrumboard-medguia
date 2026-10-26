// T-165 (fase4-pipeline-telas, US-106): o modal "Novo Lead no Pipeline"
// (T-160) precisa criar um lead que ainda não existe E o card em "Entrada de
// leads" num só passo — hoje `criarLead` (leads.ts) e `criarOportunidade`
// (oportunidades.ts) cada um abre sua própria transação via `comTenant`,
// então chamá-los em sequência não é atômico (se o segundo falhar, o
// primeiro já teria sido gravado). Esta função abre UMA transação só, com
// os dois inserts dentro dela (AC-391/AC-392): se qualquer parte falhar,
// nada é gravado.
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresasUsuarios, leads, oportunidades, usuarios } from '../db/schema';
import { normalizarNumero } from '../domain/whatsapp/numero';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export type Lead = typeof leads.$inferSelect;
export type Oportunidade = typeof oportunidades.$inferSelect;

// Mesma etapa inicial usada por `criarOportunidade` (oportunidades.ts) —
// toda oportunidade nova nasce em "Entrada de leads" (AC-391).
const ETAPA_ENTRADA_DE_LEADS = 1;

export type CampoObrigatorioNovoLead = 'nome' | 'telefone' | 'origem';

/** AC-391: um dos três campos obrigatórios do modal está ausente ou vazio. */
export class ErroCampoObrigatorio extends Error {
  constructor(public readonly campo: CampoObrigatorioNovoLead) {
    super(`Campo obrigatório ausente ou inválido: ${campo}`);
    this.name = 'ErroCampoObrigatorio';
  }
}

/** `responsavelId` informado não é de um usuário ativo da mesma empresa do `contexto`. */
export class ErroResponsavelInvalido extends Error {
  constructor() {
    super('responsavelId precisa ser de um usuário ativo da mesma empresa.');
    this.name = 'ErroResponsavelInvalido';
  }
}

export interface DadosNovoLeadComOportunidade {
  nome: string;
  telefone: string;
  email?: string | null;
  origem: string;
  valor?: string | null;
  responsavelId?: string | null;
}

export interface NovoLeadComOportunidade {
  lead: Lead;
  oportunidade: Oportunidade;
}

function campoTexto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const aparado = valor.trim();
  return aparado.length > 0 ? aparado : null;
}

/**
 * Cria um lead e o card dele em "Entrada de leads" numa única transação
 * (AC-391). Valida nome, telefone e origem (`ErroCampoObrigatorio`, com o
 * campo) e, quando informado, que `responsavelId` é de um usuário ativo da
 * mesma empresa (`ErroResponsavelInvalido`) — nada é gravado nesses casos.
 * `empresaId` gravado é sempre `contexto.empresaId`, nunca lido do `dados`.
 */
export async function criarLeadComOportunidade(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  dados: DadosNovoLeadComOportunidade
): Promise<NovoLeadComOportunidade> {
  const nome = campoTexto(dados.nome);
  if (!nome) throw new ErroCampoObrigatorio('nome');

  const telefoneE164 = campoTexto(dados.telefone) ? normalizarNumero(dados.telefone) : null;
  if (!telefoneE164) throw new ErroCampoObrigatorio('telefone');

  const origem = campoTexto(dados.origem);
  if (!origem) throw new ErroCampoObrigatorio('origem');

  const email = campoTexto(dados.email ?? null);

  return comTenant(db, contexto, async (tx) => {
    if (dados.responsavelId) {
      const responsaveisEncontrados = await tx
        .select({ id: usuarios.id })
        .from(usuarios)
        .innerJoin(empresasUsuarios, eq(empresasUsuarios.usuarioId, usuarios.id))
        .where(
          and(
            eq(usuarios.id, dados.responsavelId),
            eq(usuarios.ativo, true),
            eq(empresasUsuarios.empresaId, contexto.empresaId),
            eq(empresasUsuarios.ativo, true)
          )
        )
        .limit(1);

      if (responsaveisEncontrados.length === 0) {
        throw new ErroResponsavelInvalido();
      }
    }

    const [lead] = await tx
      .insert(leads)
      .values({
        nome,
        telefoneE164,
        email,
        origem,
        empresaId: contexto.empresaId,
      })
      .returning();

    const [oportunidade] = await tx
      .insert(oportunidades)
      .values({
        empresaId: contexto.empresaId,
        leadId: lead.id,
        etapaId: ETAPA_ENTRADA_DE_LEADS,
        valor: dados.valor ?? null,
        responsavelId: dados.responsavelId ?? null,
      })
      .returning();

    return { lead, oportunidade };
  });
}

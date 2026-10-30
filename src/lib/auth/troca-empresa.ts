// T-032 (fase1-auth-rbac, US-019): troca de empresa pelo super admin. Um
// super admin pode selecionar explicitamente outra empresa para atuar,
// registrando essa troca em auditoria (AC-045); um usuário comum nunca pode
// alternar a empresa resolvida da sua sessão (AC-046).
//
// AC-728 (T-280): com `opcoes.db` a troca é GRAVADA na sessão (`sessoes.empresa_ativa_id`) e é o que
// `resolverContextoTenant` (T-031) consulta, então vale para todas as APIs e sobrevive a reinício do servidor. Sem `db` (os
// testes de T-032), a troca fica só no mapa em memória do processo, como era antes; esse mapa NÃO decide os dados de ninguém.

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sessoes } from '../../db/schema';

export class ErroTrocaEmpresaNaoAutorizada extends Error {
  constructor() {
    super('Apenas super admin pode trocar a empresa em que está atuando.');
    this.name = 'ErroTrocaEmpresaNaoAutorizada';
  }
}

export interface AtorTrocaEmpresa {
  usuarioId: string;
  /** Empresa em que o ator está atuando na sessão antes da troca. */
  empresaId: string;
  isSuperAdmin: boolean;
}

export interface EventoAuditoriaTrocaEmpresa {
  tipo: 'troca_empresa_super_admin';
  atorId: string;
  empresaAnteriorId: string;
  empresaNovaId: string;
  ocorreuEm: Date;
}

export interface TrocarEmpresaAtivaOpcoes {
  agora?: () => Date;
  registrarAuditoria?: (evento: EventoAuditoriaTrocaEmpresa) => void | Promise<void>;
  /** AC-728: com o banco, a empresa escolhida é gravada na sessão e passa a valer para todos os dados. */
  db?: NodePgDatabase;
}

export interface TrocarEmpresaAtivaResultado {
  empresaAnteriorId: string;
  empresaNovaId: string;
}

// Token da sessão -> empresa selecionada explicitamente por um super admin.
const empresaAtivaPorToken = new Map<string, string>();

function registrarAuditoriaPadrao(evento: EventoAuditoriaTrocaEmpresa): void {
  console.info('[auditoria:troca-empresa]', JSON.stringify(evento));
}

/**
 * Troca a empresa em que o super admin está atuando na sessão (US-019).
 *
 * - AC-045: só super admin troca; a próxima chamada de
 *   `empresaAtivaResolvida` para o mesmo token retorna a nova empresa, e um
 *   evento de auditoria registra ator, empresa anterior e nova.
 * - AC-046: usuário sem `is_super_admin` é recusado antes de qualquer
 *   efeito — nenhum estado de sessão muda e nenhuma auditoria é registrada.
 */
export async function trocarEmpresaAtiva(
  ator: AtorTrocaEmpresa,
  token: string,
  novaEmpresaId: string,
  opcoes: TrocarEmpresaAtivaOpcoes = {}
): Promise<TrocarEmpresaAtivaResultado> {
  if (!ator.isSuperAdmin) {
    throw new ErroTrocaEmpresaNaoAutorizada();
  }

  const empresaAnteriorId = empresaAtivaPorToken.get(token) ?? ator.empresaId;
  empresaAtivaPorToken.set(token, novaEmpresaId);
  if (opcoes.db) {
    await opcoes.db.update(sessoes).set({ empresaAtivaId: novaEmpresaId }).where(eq(sessoes.token, token));
  }

  const agora = opcoes.agora ? opcoes.agora() : new Date();
  const registrar = opcoes.registrarAuditoria ?? registrarAuditoriaPadrao;
  await registrar({
    tipo: 'troca_empresa_super_admin',
    atorId: ator.usuarioId,
    empresaAnteriorId,
    empresaNovaId: novaEmpresaId,
    ocorreuEm: agora,
  });

  return { empresaAnteriorId, empresaNovaId: novaEmpresaId };
}

/**
 * Resolve a empresa ativa de uma sessão levando em conta trocas feitas por
 * super admin (AC-045). Sem troca registrada para o token, retorna
 * `empresaIdSessao` (o vínculo normal resolvido por T-031) sem alteração
 * (AC-046 — para usuário comum, nunca existe troca registrada).
 */
export function empresaAtivaResolvida(token: string, empresaIdSessao: string): string {
  return empresaAtivaPorToken.get(token) ?? empresaIdSessao;
}

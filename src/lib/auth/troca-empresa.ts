// T-032 (fase1-auth-rbac, US-019): troca de empresa pelo super admin. Um
// super admin pode selecionar explicitamente outra empresa para atuar,
// registrando essa troca em auditoria (AC-045); um usuário comum nunca pode
// alternar a empresa resolvida da sua sessão (AC-046).
//
// Ainda não existe, no schema entregue por `fase1-schema-drizzle`, uma
// coluna ou tabela para "empresa ativa da sessão" — e alterar o schema é
// fora do escopo desta tarefa (arquivos permitidos: só este módulo e seu
// teste). A troca fica registrada em memória do processo, por token de
// sessão, na mesma linha do default de auditoria via `console.info` em
// T-028 (src/lib/auth/convites.ts): não deixa a obrigação de "as próximas
// resoluções retornam a empresa Y" sem efeito nenhum enquanto uma tabela
// dedicada não existir. Uma futura tarefa que integre isso a
// `resolverContextoTenant` (T-031) precisa consultar `empresaAtivaResolvida`.

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

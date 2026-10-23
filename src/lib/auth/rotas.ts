// T-143 (fase4-design-system-shell-acesso, US-104): rotas públicas e matriz
// de papel mínimo por rota — fonte única usada pelo middleware (AC-379 a
// AC-382) e, depois, pelo menu da casca (T-146) para esconder itens que o
// papel do usuário não pode ver (AC-349, ASM-123). Rotas (de página ou de
// API) que não aparecem em `REGRAS_PAPEL` só exigem sessão válida — nenhuma
// restrição extra de papel.
import type { PapelUsuario } from './convites';

export interface ContextoAcesso {
  papel: PapelUsuario;
  isSuperAdmin: boolean;
}

const HIERARQUIA_PAPEL: Record<PapelUsuario, number> = {
  ATENDENTE: 0,
  GERENTE: 1,
  MASTER: 2,
};

// AC-380: nenhuma delas é redirecionada nem bloqueada pelo middleware — as
// rotas de webhook e cron seguem protegidas pelos próprios segredos
// (AC-203, AC-304), não pela sessão do Better Auth.
const PREFIXOS_PUBLICOS = [
  '/login',
  '/esqueci-senha',
  '/redefinir-senha',
  '/convite',
  '/sem-acesso',
  '/api/auth',
  '/api/health',
  '/api/whatsapp/webhook',
  '/api/webhooks/resend',
  '/api/cron',
];

function combinaPrefixo(pathname: string, prefixo: string): boolean {
  return pathname === prefixo || pathname.startsWith(`${prefixo}/`);
}

export function ehRotaPublica(pathname: string): boolean {
  return PREFIXOS_PUBLICOS.some((prefixo) => combinaPrefixo(pathname, prefixo));
}

interface RegraPapel {
  prefixo: string;
  papelMinimo?: PapelUsuario;
  somenteSuperAdmin?: boolean;
}

// ASM-123: matriz do menu por papel (grupos de AC-348/AC-349), a partir do
// inventário de telas (docs/ui/inventario-telas.md).
const REGRAS_PAPEL: RegraPapel[] = [
  // Administração — Empresas: só o super admin vê (nem o MASTER, AC-349).
  { prefixo: '/admin/empresas', somenteSuperAdmin: true },
  // Administração — Equipe e Motivos de Perda: GERENTE+.
  { prefixo: '/equipe', papelMinimo: 'GERENTE' },
  { prefixo: '/configuracoes/motivos-perda', papelMinimo: 'GERENTE' },
  // Análises: GERENTE+ (mesmo mínimo já aplicado em /api/relatorios/kpis,
  // ASM-074/AC-229).
  { prefixo: '/indicadores', papelMinimo: 'GERENTE' },
  { prefixo: '/relatorios-comerciais', papelMinimo: 'GERENTE' },
  { prefixo: '/relatorios', papelMinimo: 'GERENTE' },
  { prefixo: '/api/relatorios', papelMinimo: 'GERENTE' },
];

/** A regra de prefixo mais específico vence — `/relatorios-comerciais` não cai na regra de `/relatorios`. */
function encontrarRegra(pathname: string): RegraPapel | undefined {
  let encontrada: RegraPapel | undefined;
  for (const regra of REGRAS_PAPEL) {
    if (
      combinaPrefixo(pathname, regra.prefixo) &&
      (!encontrada || regra.prefixo.length > encontrada.prefixo.length)
    ) {
      encontrada = regra;
    }
  }
  return encontrada;
}

/** AC-381/AC-349: decide se o papel autenticado pode acessar a rota (página ou API). */
export function podeAcessarRota(contexto: ContextoAcesso, pathname: string): boolean {
  const regra = encontrarRegra(pathname);
  if (!regra) return true;
  if (contexto.isSuperAdmin) return true;
  if (regra.somenteSuperAdmin) return false;
  if (!regra.papelMinimo) return true;
  return HIERARQUIA_PAPEL[contexto.papel] >= HIERARQUIA_PAPEL[regra.papelMinimo];
}

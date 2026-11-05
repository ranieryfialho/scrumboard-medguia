// T-143 (fase4-design-system-shell-acesso, US-104): rotas públicas e matriz
// de papel mínimo por rota — fonte única usada pelo middleware (AC-379 a
// AC-382) e, depois, pelo menu da casca (T-146) para esconder itens que o
// papel do usuário não pode ver (AC-349, ASM-123). Rotas (de página ou de
// API) que não aparecem em `REGRAS_PAPEL` só exigem sessão válida — nenhuma
// restrição extra de papel.
import type { PapelUsuario } from './convites';
import { modulosEfetivos, moduloDaRota } from './modulos';

export interface ContextoAcesso {
  papel: PapelUsuario;
  isSuperAdmin: boolean;
  /** T-322: módulos liberados da pessoa (`null` ou ausente = padrão do papel). */
  modulos?: string[] | null;
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
  // As telas públicas de convite, esqueci-senha e redefinição chamam estas APIs sem sessão (AC-380).
  '/api/acesso',
  '/api/health',
  '/api/whatsapp/webhook',
  '/api/webhooks/resend',
  '/api/cron',
  // fase5-email-descadastro (AC-721): quem recebe a campanha não tem login — página e rota públicas, assinadas pelo token.
  '/descadastro',
  '/api/descadastro',
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
  // fase5-metas: a tela de metas é de gestão; a leitura (`GET /api/metas`) é de qualquer sessão.
  { prefixo: '/configuracoes/metas', papelMinimo: 'GERENTE' },
  // fase5-investimento-midia: dado financeiro, tela e API só de gestão (ASM-220).
  { prefixo: '/configuracoes/investimento', papelMinimo: 'GERENTE' },
  // fase5-email-config (ASM-258): a chave do Resend da empresa é de gestão — tela e API.
  { prefixo: '/configuracoes/email', papelMinimo: 'GERENTE' },
  { prefixo: '/api/configuracoes/email', papelMinimo: 'GERENTE' },
  // T-301: conectar a conta Google do Meet é de gestão — tela e API (o estado do Meet na agenda, `GET /api/reunioes/meet`, é de qualquer sessão).
  { prefixo: '/configuracoes/google', papelMinimo: 'GERENTE' },
  { prefixo: '/api/integracoes/google', papelMinimo: 'GERENTE' },
  { prefixo: '/api/investimento', papelMinimo: 'GERENTE' },
  // Análises (Indicadores, Marketing e Comercial) e Campanhas: quem acessa é decidido pelos módulos liberados (`modulos.ts`), nas páginas e nas
  // APIs do módulo; gerente e master têm por padrão, os demais só se alguém liberar.
  // fase4-admin: as rotas de administração seguem a mesma matriz das telas.
  { prefixo: '/api/equipe', papelMinimo: 'GERENTE' },
  { prefixo: '/api/configuracoes/motivos-perda', papelMinimo: 'GERENTE' },
  { prefixo: '/api/admin/empresas', somenteSuperAdmin: true },
  // fase5-whatsapp-lote-disparo (ASM-247): disparo em massa é decisão de gestão — tela e API.
  { prefixo: '/whatsapp/lote', papelMinimo: 'GERENTE' },
  { prefixo: '/api/whatsapp/lote', papelMinimo: 'GERENTE' },
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
  if (contexto.isSuperAdmin) return true;
  // T-322: os módulos da pessoa contam nas páginas e nas APIs que pertencem a um módulo. Sem módulos gravados vale o padrão do papel, que
  // pode ser menor que o teto (Campanhas, Indicadores, Marketing e Comercial são opcionais para quem não é gerente).
  const modulo = moduloDaRota(pathname);
  if (modulo && !modulosEfetivos(contexto.papel, false, contexto.modulos).has(modulo.id)) return false;
  const regra = encontrarRegra(pathname);
  if (!regra) return true;
  if (regra.somenteSuperAdmin) return false;
  if (!regra.papelMinimo) return true;
  return HIERARQUIA_PAPEL[contexto.papel] >= HIERARQUIA_PAPEL[regra.papelMinimo];
}

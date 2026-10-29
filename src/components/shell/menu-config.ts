// T-146 (fase4-design-system-shell-acesso, US-098): grupos e itens do menu
// lateral (AC-348), na ordem e com o ícone/rota do protótipo
// (`13._tarefas_fila_do_turno_atual/code.html`, `<nav>`). Rotas conferidas
// contra `docs/ui/inventario-telas.md` e a matriz de papel de
// `src/lib/auth/rotas.ts` (ASM-123) — mesma regra: só o super admin vê
// "Empresas"; Análises e o resto de Administração exigem GERENTE+.
import type { PapelUsuario } from '@/lib/auth/convites';

export interface ItemMenu {
  id: string;
  rotulo: string;
  href: string;
  icone: string;
  /** Qual contador de `useContadores` (T-146) este item mostra, se algum (AC-351). */
  contador?: 'tarefasDoTurno' | 'tarefasAtrasadas' | 'whatsappNaoLidas';
}

export interface GrupoMenu {
  titulo: string;
  /** Grupos de Análises e Administração exigem GERENTE+ (ASM-123); omitido = todo papel autenticado. */
  papelMinimo?: PapelUsuario;
  itens: ItemMenu[];
}

const HIERARQUIA_PAPEL: Record<PapelUsuario, number> = {
  ATENDENTE: 0,
  GERENTE: 1,
  MASTER: 2,
};

export const GRUPOS_MENU: GrupoMenu[] = [
  {
    titulo: 'Operação',
    itens: [
      { id: 'funil-pipeline', rotulo: 'Funil Pipeline', href: '/pipeline', icone: 'view_kanban' },
      { id: 'lista', rotulo: 'Lista', href: '/pipeline/lista', icone: 'format_list_bulleted' },
      { id: 'arquivados', rotulo: 'Arquivados', href: '/pipeline/arquivados', icone: 'archive' },
      {
        id: 'tarefas-do-turno',
        rotulo: 'Tarefas do Turno',
        href: '/tarefas',
        icone: 'check_circle',
        contador: 'tarefasDoTurno',
      },
      {
        id: 'tarefas-atrasadas',
        rotulo: 'Tarefas Atrasadas',
        href: '/tarefas/atrasadas',
        icone: 'warning',
        contador: 'tarefasAtrasadas',
      },
      { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: 'calendar_month' },
    ],
  },
  {
    titulo: 'Comunicação',
    itens: [
      {
        id: 'whatsapp-inbox',
        rotulo: 'WhatsApp Inbox',
        href: '/whatsapp',
        icone: 'chat',
        contador: 'whatsappNaoLidas',
      },
      { id: 'whatsapp-conexao', rotulo: 'Conexão & QR Code', href: '/whatsapp/conexao', icone: 'qr_code_2' },
      { id: 'whatsapp-configuracao', rotulo: 'Configuração Evolution', href: '/whatsapp/configuracao', icone: 'settings_ethernet' },
      { id: 'campanhas', rotulo: 'Campanhas', href: '/campanhas', icone: 'send' },
    ],
  },
  {
    titulo: 'Análises',
    papelMinimo: 'GERENTE',
    itens: [
      { id: 'indicadores', rotulo: 'Indicadores', href: '/indicadores', icone: 'monitoring' },
      { id: 'relatorios', rotulo: 'Relatórios', href: '/relatorios', icone: 'description' },
      { id: 'comercial', rotulo: 'Comercial', href: '/relatorios-comerciais', icone: 'query_stats' },
    ],
  },
  {
    titulo: 'Administração',
    papelMinimo: 'GERENTE',
    itens: [
      { id: 'equipe', rotulo: 'Equipe', href: '/equipe', icone: 'groups' },
      {
        id: 'motivos-de-perda',
        rotulo: 'Motivos de Perda',
        href: '/configuracoes/motivos-perda',
        icone: 'cancel',
      },
      { id: 'metas', rotulo: 'Metas', href: '/configuracoes/metas', icone: 'flag' },
      { id: 'empresas', rotulo: 'Empresas', href: '/admin/empresas', icone: 'apartment' },
    ],
  },
];

/** AC-349/ASM-123: "Empresas" é o único item restrito ao super admin — mesmo MASTER não o vê. */
function podeVerItem(item: ItemMenu, isSuperAdmin: boolean): boolean {
  if (item.id === 'empresas') return isSuperAdmin;
  return true;
}

/** AC-349: filtra grupos e itens pelo papel/`isSuperAdmin` da sessão — o super admin vê tudo, inclusive Empresas. */
export function menuParaPapel(papel: PapelUsuario, isSuperAdmin: boolean): GrupoMenu[] {
  return GRUPOS_MENU.filter(
    (grupo) => isSuperAdmin || !grupo.papelMinimo || HIERARQUIA_PAPEL[papel] >= HIERARQUIA_PAPEL[grupo.papelMinimo]
  ).map((grupo) => ({
    ...grupo,
    itens: grupo.itens.filter((item) => podeVerItem(item, isSuperAdmin)),
  }));
}

function combinaRota(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * AC-350: item ativo é o de rota mais específica que combina com `pathname`
 * (mesmo critério de "prefixo mais longo vence" de `podeAcessarRota` em
 * `src/lib/auth/rotas.ts`) — evita que `/pipeline/lista` destaque também
 * "Funil Pipeline" (`/pipeline`).
 */
export function encontrarItemAtivo(grupos: GrupoMenu[], pathname: string): ItemMenu | undefined {
  let ativo: ItemMenu | undefined;
  for (const grupo of grupos) {
    for (const item of grupo.itens) {
      if (combinaRota(pathname, item.href) && (!ativo || item.href.length > ativo.href.length)) {
        ativo = item;
      }
    }
  }
  return ativo;
}

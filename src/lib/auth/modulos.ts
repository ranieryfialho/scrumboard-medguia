// T-322 (fase4-admin, US-138): os "módulos liberados" de cada pessoa — como no CRM antigo, além do papel o MASTER escolhe a que partes
// do sistema o colaborador tem acesso. O papel continua sendo o TETO (um atendente nunca ganha relatórios por marcar um módulo): os
// módulos só restringem dentro do que o papel já alcança. MASTER e super admin sempre têm tudo. Sem módulos gravados (`null`), vale
// o padrão do papel. Funções puras, usadas pelo servidor (guardar a rota), pelo menu e pelas telas de convite e de equipe.
import type { PapelUsuario } from './convites';

export type ModuloId = 'pipeline' | 'tarefas' | 'agenda' | 'whatsapp' | 'campanhas' | 'indicadores' | 'relatorios' | 'comercial' | 'administracao';

export interface Modulo {
  id: ModuloId;
  rotulo: string;
  descricao: string;
  /** Os prefixos de página que o módulo libera (as APIs seguem as regras de papel, não as de módulo). */
  prefixos: string[];
  /** As APIs que pertencem ao módulo: obedecem a ele (não ao papel). As demais APIs seguem as regras de papel. */
  prefixosApi?: string[];
  /** Os itens do menu lateral (`menu-config.ts`) que o módulo libera. */
  itensMenu: string[];
  /** O menor papel que PODE ter o módulo (o teto): abaixo disso nem marcando. */
  papelMinimo: PapelUsuario;
  /** O menor papel que o tem POR PADRÃO (sem módulos gravados). Acima do papel mínimo, o módulo é opcional: só vale se for marcado. */
  padraoDesde: PapelUsuario;
}

export const MODULOS: Modulo[] = [
  { id: 'pipeline', rotulo: 'Funil, Lista e Arquivados', descricao: 'Pipeline de leads e os cards.', prefixos: ['/pipeline'], itensMenu: ['funil-pipeline', 'lista', 'arquivados'], papelMinimo: 'ATENDENTE', padraoDesde: 'ATENDENTE' },
  { id: 'tarefas', rotulo: 'Tarefas do Turno e Atrasadas', descricao: 'Fila de toques da cadência de 18 toques.', prefixos: ['/tarefas'], itensMenu: ['tarefas-do-turno', 'tarefas-atrasadas'], papelMinimo: 'ATENDENTE', padraoDesde: 'ATENDENTE' },
  { id: 'agenda', rotulo: 'Agenda de reuniões', descricao: 'Reuniões e Google Meet.', prefixos: ['/agenda'], itensMenu: ['agenda'], papelMinimo: 'ATENDENTE', padraoDesde: 'ATENDENTE' },
  {
    id: 'whatsapp',
    rotulo: 'WhatsApp',
    descricao: 'Inbox, conexão, templates e envio em lote.',
    prefixos: ['/whatsapp'],
    itensMenu: ['whatsapp-inbox', 'whatsapp-conexao', 'whatsapp-configuracao', 'whatsapp-templates', 'whatsapp-lote'],
    papelMinimo: 'ATENDENTE',
    padraoDesde: 'ATENDENTE',
  },
  { id: 'campanhas', rotulo: 'Campanhas (mala direta)', descricao: 'Campanhas de e-mail. O atendente só tem se o master ou o gerente liberar.', prefixos: ['/campanhas'], prefixosApi: ['/api/campanhas'], itensMenu: ['campanhas'], papelMinimo: 'ATENDENTE', padraoDesde: 'GERENTE' },
  { id: 'indicadores', rotulo: 'Indicadores', descricao: 'Governança e funil de vendas. Quem não é gerente só tem se o master ou o gerente liberar.', prefixos: ['/indicadores'], prefixosApi: ['/api/relatorios/kpis', '/api/relatorios/funil', '/api/relatorios/alertas'], itensMenu: ['indicadores'], papelMinimo: 'ATENDENTE', padraoDesde: 'GERENTE' },
  { id: 'relatorios', rotulo: 'Marketing e Tráfego', descricao: 'Relatório de origem dos leads e mídia. Quem não é gerente só tem se o master ou o gerente liberar.', prefixos: ['/relatorios'], prefixosApi: ['/api/relatorios/marketing'], itensMenu: ['relatorios'], papelMinimo: 'ATENDENTE', padraoDesde: 'GERENTE' },
  { id: 'comercial', rotulo: 'Comercial e Vendas', descricao: 'Receita, ranking e motivos de perda. Quem não é gerente só tem se o master ou o gerente liberar.', prefixos: ['/relatorios-comerciais'], prefixosApi: ['/api/relatorios/comercial'], itensMenu: ['comercial'], papelMinimo: 'ATENDENTE', padraoDesde: 'GERENTE' },
  {
    id: 'administracao',
    rotulo: 'Equipe e Configurações',
    descricao: 'Equipe, metas, investimento, e-mail e motivos de perda.',
    prefixos: ['/equipe', '/configuracoes'],
    itensMenu: ['equipe', 'motivos-de-perda', 'metas', 'investimento-midia', 'email-empresa', 'google-meet'],
    papelMinimo: 'GERENTE',
    padraoDesde: 'GERENTE',
  },
];

const ORDEM: Record<PapelUsuario, number> = { ATENDENTE: 0, GERENTE: 1, MASTER: 2 };

export const ids = (lista: Modulo[]): ModuloId[] => lista.map((m) => m.id);

/** Os módulos que o papel alcança (o teto). */
export function modulosDoPapel(papel: PapelUsuario): ModuloId[] {
  return ids(MODULOS.filter((m) => ORDEM[papel] >= ORDEM[m.papelMinimo]));
}

/** Os módulos que o papel tem POR PADRÃO, sem nada gravado (os opcionais, como Campanhas para atendente, ficam de fora). */
export function modulosPadraoDoPapel(papel: PapelUsuario): ModuloId[] {
  return ids(MODULOS.filter((m) => ORDEM[papel] >= ORDEM[m.padraoDesde]));
}

/** O papel pode ter módulos personalizados? MASTER sempre tem tudo. */
export const aceitaModulosPersonalizados = (papel: PapelUsuario): boolean => papel !== 'MASTER';

/**
 * Os módulos que a pessoa de fato tem: o padrão do papel (sem módulos gravados) ou o que foi marcado, sempre dentro do teto do papel.
 * MASTER e super admin: tudo.
 */
export function modulosEfetivos(papel: PapelUsuario, isSuperAdmin: boolean, gravados: readonly string[] | null | undefined): Set<ModuloId> {
  const teto = isSuperAdmin ? ids(MODULOS) : modulosDoPapel(papel);
  if (isSuperAdmin || !aceitaModulosPersonalizados(papel)) return new Set(teto);
  // Sem módulos gravados vale o padrão do papel (não o teto: o que é opcional só entra se alguém liberar).
  if (!Array.isArray(gravados)) return new Set(modulosPadraoDoPapel(papel));
  return new Set(teto.filter((id) => gravados.includes(id)));
}

/** O módulo dono de uma página ou de uma API do módulo (o prefixo mais específico vence); `undefined` para as telas que não são de módulo (login, sem-acesso...). */
export function moduloDaRota(pathname: string): Modulo | undefined {
  let achado: { modulo: Modulo; tamanho: number } | undefined;
  for (const modulo of MODULOS) {
    for (const prefixo of [...modulo.prefixos, ...(modulo.prefixosApi ?? [])]) {
      if ((pathname === prefixo || pathname.startsWith(`${prefixo}/`)) && (!achado || prefixo.length > achado.tamanho)) achado = { modulo, tamanho: prefixo.length };
    }
  }
  return achado?.modulo;
}

/**
 * Valida os módulos que vieram de fora: só ids conhecidos, só os do teto do papel, sem repetir, e ao menos um.
 * `null` = "voltar ao padrão do papel". `undefined` = entrada inválida.
 */
export function lerModulos(entrada: unknown, papel: PapelUsuario): ModuloId[] | null | undefined {
  if (entrada === null) return null;
  if (!Array.isArray(entrada)) return undefined;
  const teto = new Set(modulosDoPapel(papel));
  const lista: ModuloId[] = [];
  for (const m of entrada) {
    if (typeof m !== 'string' || !teto.has(m as ModuloId)) return undefined;
    if (!lista.includes(m as ModuloId)) lista.push(m as ModuloId);
  }
  return lista.length > 0 ? lista : undefined;
}

/** Os perfis prontos do CRM antigo, traduzidos para papel + módulos. */
export const PERFIS_PRONTOS: { id: string; rotulo: string; papel: PapelUsuario; modulos: ModuloId[] }[] = [
  { id: 'comercial', rotulo: 'Vendas / Comercial', papel: 'ATENDENTE', modulos: ['pipeline', 'tarefas', 'agenda', 'whatsapp'] },
  { id: 'comercial-campanhas', rotulo: 'Vendas / Comercial + Campanhas', papel: 'ATENDENTE', modulos: ['pipeline', 'tarefas', 'agenda', 'whatsapp', 'campanhas'] },
  { id: 'marketing', rotulo: 'Gestor de Tráfego / MKT', papel: 'GERENTE', modulos: ['pipeline', 'relatorios', 'indicadores', 'campanhas'] },
  { id: 'admin', rotulo: 'CEO / Administrador', papel: 'MASTER', modulos: ids(MODULOS) },
];

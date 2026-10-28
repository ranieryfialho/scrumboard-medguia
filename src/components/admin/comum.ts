// T-213 (fase4-admin, US-137 a US-142): tipos, rótulos e formatação compartilhados pelas
// telas de administração.
export type Papel = 'ATENDENTE' | 'GERENTE' | 'MASTER';
export type Situacao = 'ativo' | 'pendente' | 'inativo';

export interface ColaboradorView {
  usuarioId: string;
  nome: string;
  email: string;
  papel: Papel;
  status: Situacao;
  ultimoAcesso: string | null;
}

export interface UsuarioLogado {
  nome?: string;
  email?: string;
  papel?: string;
  isSuperAdmin?: boolean;
}

export const PAPEIS: Papel[] = ['MASTER', 'GERENTE', 'ATENDENTE'];
export const ROTULO_DA_SITUACAO: Record<Situacao, string> = { ativo: 'Ativo', pendente: 'Pendente', inativo: 'Inativo' };

export const COR_DO_PAPEL: Record<Papel, string> = {
  MASTER: 'bg-secondary-fixed text-on-secondary-fixed',
  GERENTE: 'bg-info-surface text-info-text',
  ATENDENTE: 'bg-surface-container text-text-secondary',
};

export const COR_DA_SITUACAO: Record<Situacao, string> = {
  ativo: 'bg-success-surface text-success-text',
  pendente: 'bg-warning-surface text-warning-text',
  inativo: 'bg-surface-container text-text-muted',
};

export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter((p) => /[A-Za-zÀ-ú]/.test(p[0] ?? ''));
  return (partes.length ? partes : [nome]).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '#';
}

/** AC-581: "Há 4 min", "Há 3 h", "Há 5 dias" ou a data; `null` vira "Nunca acessou". */
export function ultimoAcessoTexto(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'Nunca acessou';
  const minutos = Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutos < 1) return 'Agora mesmo';
  if (minutos < 60) return `Há ${minutos} min`;
  if (minutos < 24 * 60) return `Há ${Math.floor(minutos / 60)} h`;
  if (minutos < 30 * 24 * 60) {
    const dias = Math.floor(minutos / (24 * 60));
    return `Há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  }
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

export function formatarData(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

/** AC-582 a AC-590: o motivo, em português, de cada recusa da API de administração. */
export const MENSAGENS_DE_ERRO: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
  NAO_PODE_ALTERAR_A_SI: 'Você não pode alterar o seu próprio acesso.',
  ULTIMO_MASTER: 'A empresa precisa ter pelo menos um MASTER ativo.',
  COLABORADOR_NAO_ENCONTRADO: 'Colaborador não encontrado.',
  CONVITE_NAO_PENDENTE: 'Esta pessoa não tem convite pendente.',
  JA_E_COLABORADOR: 'Esta pessoa já faz parte da equipe.',
  MOTIVO_JA_EXISTE: 'Já existe um motivo com esse nome.',
  MOTIVO_SISTEMICO: 'Motivo sistêmico não pode ser alterado.',
  SLUG_EM_USO: 'Esse identificador já está em uso.',
  EMPRESA_ATUAL: 'Você não pode suspender a empresa em que está agora.',
  EMPRESA_NAO_ENCONTRADA: 'Empresa não encontrada.',
};

export function mensagemDeErro(codigo: string | undefined, padrao = 'Não foi possível concluir a ação. Tente de novo.'): string {
  return (codigo && MENSAGENS_DE_ERRO[codigo]) || padrao;
}

export const podeGerir = (u: UsuarioLogado | null): boolean => u?.isSuperAdmin === true || u?.papel === 'MASTER';

export interface EmpresaView {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  criadoEm: string;
}

/** AC-606: o identificador sugerido a partir do nome (minúsculas, sem acento, hífens, até 40). */
export function sugerirSlug(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** Troca a empresa ativa do super admin (`POST /api/empresa-ativa`, AC-601). */
export async function trocarEmpresaAtiva(empresaId: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  try {
    const r = await fetch('/api/empresa-ativa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresaId }) });
    if (r.ok) return { ok: true };
    const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
    return { ok: false, mensagem: mensagemDeErro(corpo?.codigo) };
  } catch {
    return { ok: false, mensagem: mensagemDeErro(undefined) };
  }
}

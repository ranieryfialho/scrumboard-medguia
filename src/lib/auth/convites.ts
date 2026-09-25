// T-028 (fase1-auth-rbac, US-015): convite de um novo usuário por um
// administrador da empresa. Cria o vínculo em `empresas_usuarios` e um
// token de uso único em `tokens_verificacao` — a definição de senha a
// partir desse token é escopo de T-029 (US-016).
//
// Ainda não existe uma tabela de auditoria própria no schema (o que a
// fase1-schema-drizzle entregou não inclui uma) — `registrarAuditoria`
// (AC-038) é um ponto de extensão injetável, com um default que emite o
// evento via `console.info`, para não deixar a obrigação de "registra"
// sem efeito nenhum enquanto uma tabela dedicada não existir.
import { randomBytes, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresasUsuarios, papelUsuarioEnum, tokensVerificacao, usuarios } from '../../db/schema';

export type PapelUsuario = (typeof papelUsuarioEnum.enumValues)[number];

const PAPEIS_VALIDOS = new Set<string>(papelUsuarioEnum.enumValues);

// Prazo curto (AC-036) — 24h, decidido em Q-006 (spec).
export const TTL_CONVITE_MS = 24 * 60 * 60 * 1000;

const PREFIXO_IDENTIFICADOR_CONVITE = 'convite';

/** Convenção do `identificador` em `tokens_verificacao` para tokens de convite — reaproveitada por T-029. */
export function identificadorConvite(email: string): string {
  return `${PREFIXO_IDENTIFICADOR_CONVITE}:${email}`;
}

export class ErroConvitePermissaoNegada extends Error {
  constructor() {
    super('Papel do ator não tem permissão para convidar com o papel solicitado.');
    this.name = 'ErroConvitePermissaoNegada';
  }
}

export class ErroConviteEmpresaObrigatoria extends Error {
  constructor() {
    super('Super admin precisa informar explicitamente a empresa de destino do convite.');
    this.name = 'ErroConviteEmpresaObrigatoria';
  }
}

export class ErroConvitePapelInvalido extends Error {
  constructor(papel: string) {
    super(`Papel de convite inválido: "${papel}".`);
    this.name = 'ErroConvitePapelInvalido';
  }
}

export interface AtorConvite {
  usuarioId: string;
  /** Empresa em que o ator está atuando na sessão — ignorado quando `isSuperAdmin`. */
  empresaId: string;
  papel: PapelUsuario;
  isSuperAdmin: boolean;
}

export interface ConvidarUsuarioInput {
  email: string;
  papel: PapelUsuario;
  /** Só é lido quando o ator é super admin (AC-038) — obrigatório nesse caso. */
  empresaId?: string;
}

export interface EventoAuditoriaConvite {
  tipo: 'convite_super_admin';
  atorId: string;
  empresaId: string;
  papelConvidado: PapelUsuario;
  emailConvidado: string;
  criadoEm: Date;
}

export interface ConvidarUsuarioOpcoes {
  agora?: () => Date;
  gerarToken?: () => string;
  ttlMs?: number;
  registrarAuditoria?: (evento: EventoAuditoriaConvite) => void | Promise<void>;
}

export interface ConvidarUsuarioResultado {
  usuarioId: string;
  empresaId: string;
  papel: PapelUsuario;
  token: string;
  expiraEm: Date;
}

function registrarAuditoriaPadrao(evento: EventoAuditoriaConvite): void {
  console.info('[auditoria:convite]', JSON.stringify(evento));
}

// ASM-012: GERENTE só convida para ATENDENTE; MASTER e super admin convidam
// para qualquer papel (dentro da empresa resolvida).
function podeConvidar(ator: AtorConvite, papelConvidado: PapelUsuario): boolean {
  if (ator.isSuperAdmin) return true;
  if (ator.papel === 'MASTER') return true;
  if (ator.papel === 'GERENTE') return papelConvidado === 'ATENDENTE';
  return false;
}

/**
 * Convida um e-mail para uma empresa com um papel (US-015).
 *
 * - AC-036: cria o vínculo pendente em `empresas_usuarios` e um token de
 *   convite de uso único com prazo curto em `tokens_verificacao`.
 * - AC-037: papel sem permissão de convidar é recusado antes de qualquer
 *   escrita.
 * - AC-038: super admin convida explicitamente para a empresa informada e
 *   gera um evento de auditoria.
 */
export async function convidarUsuario(
  db: NodePgDatabase,
  ator: AtorConvite,
  input: ConvidarUsuarioInput,
  opcoes: ConvidarUsuarioOpcoes = {}
): Promise<ConvidarUsuarioResultado> {
  if (!PAPEIS_VALIDOS.has(input.papel)) {
    throw new ErroConvitePapelInvalido(input.papel);
  }

  let empresaDestinoId: string;
  if (ator.isSuperAdmin) {
    if (!input.empresaId) {
      throw new ErroConviteEmpresaObrigatoria();
    }
    empresaDestinoId = input.empresaId;
  } else {
    // Nunca confia num `empresaId` vindo do chamador — só na empresa em que
    // o ator está atuando (mesmo espírito de AC-043, aplicado aqui em
    // T-028 porque a resolução de sessão de T-031 ainda não existe).
    empresaDestinoId = ator.empresaId;
  }

  if (!podeConvidar(ator, input.papel)) {
    throw new ErroConvitePermissaoNegada();
  }

  const agora = opcoes.agora ? opcoes.agora() : new Date();
  const expiraEm = new Date(agora.getTime() + (opcoes.ttlMs ?? TTL_CONVITE_MS));
  const token = opcoes.gerarToken ? opcoes.gerarToken() : randomBytes(32).toString('hex');

  const usuarioId = await db.transaction(async (tx) => {
    const existentes = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(eq(usuarios.email, input.email))
      .limit(1);

    const id = existentes[0]?.id ?? randomUUID();

    if (existentes.length === 0) {
      await tx.insert(usuarios).values({
        id,
        email: input.email,
        // Convite ainda não coletou o nome — quem aceita o convite (T-029)
        // é quem tem essa informação; placeholder até lá.
        nome: input.email,
        isSuperAdmin: false,
        ativo: true,
      });
    }

    await tx.insert(empresasUsuarios).values({
      empresaId: empresaDestinoId,
      usuarioId: id,
      papel: input.papel,
      ativo: true,
    });

    await tx.insert(tokensVerificacao).values({
      identificador: identificadorConvite(input.email),
      valor: token,
      expiraEm,
    });

    return id;
  });

  if (ator.isSuperAdmin) {
    const registrar = opcoes.registrarAuditoria ?? registrarAuditoriaPadrao;
    await registrar({
      tipo: 'convite_super_admin',
      atorId: ator.usuarioId,
      empresaId: empresaDestinoId,
      papelConvidado: input.papel,
      emailConvidado: input.email,
      criadoEm: agora,
    });
  }

  return {
    usuarioId,
    empresaId: empresaDestinoId,
    papel: input.papel,
    token,
    expiraEm,
  };
}

// T-108 (fase3-etl-supabase, US-074): leitor da origem Supabase legada.
// ASM-087/Q-027: o ETL lê o legado por conexão direta somente leitura, com
// a credencial só em variável de ambiente — nunca `DATABASE_URL` (essa é do
// destino) e nunca hard-coded (P-002). `default_transaction_read_only=on`
// faz o próprio Postgres recusar qualquer escrita nessa conexão, então uma
// etapa que acidentalmente tentasse gravar na origem falha na origem, não
// silenciosamente.
import { Pool } from 'pg';

import type { PapelLegado, UsuarioLegado } from './identidade';

export const VARIAVEL_AMBIENTE_ORIGEM = 'SUPABASE_LEGADO_DATABASE_URL';

export class ErroOrigemSemCredencial extends Error {
  constructor() {
    super(
      `${VARIAVEL_AMBIENTE_ORIGEM} não definida — necessária para ler o Supabase legado.`
    );
    this.name = 'ErroOrigemSemCredencial';
  }
}

/**
 * Abre uma conexão somente leitura com o Supabase legado. A URL vem de
 * `SUPABASE_LEGADO_DATABASE_URL` por padrão; o parâmetro existe só para
 * facilitar teste.
 */
export function conectarOrigem(
  databaseUrl: string | undefined = process.env[VARIAVEL_AMBIENTE_ORIGEM]
): Pool {
  if (!databaseUrl) {
    throw new ErroOrigemSemCredencial();
  }
  return new Pool({
    connectionString: databaseUrl,
    options: '-c default_transaction_read_only=on',
  });
}

// T-138 (AC-340, AC-341, ASM-121): de onde vêm os usuários. Por padrão
// `auth.users`; no Supabase do CRM o usuário de leitura não recebe acesso ao
// schema `auth`, então a operação cria a view `etl.usuarios` (só `id`,
// `email` e `raw_user_meta_data`) e aponta esta variável para ela.
export const VARIAVEL_AMBIENTE_USUARIOS = 'SUPABASE_LEGADO_TABELA_USUARIOS';
export const ORIGEM_USUARIOS_PADRAO = 'auth.users';

// O nome entra no texto SQL (identificador não pode ser parâmetro), então só
// passa `nome` ou `schema.nome` em minúsculas, sem aspas nem espaços.
const PADRAO_ORIGEM_USUARIOS = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

export class ErroOrigemUsuariosInvalida extends Error {
  constructor(nome: string) {
    super(
      `${VARIAVEL_AMBIENTE_USUARIOS} inválida: ${JSON.stringify(nome)} — use "nome" ou "schema.nome" em minúsculas, sem aspas, espaços nem pontuação.`
    );
    this.name = 'ErroOrigemUsuariosInvalida';
  }
}

/** Valida o nome da origem dos usuários antes de ele entrar numa consulta (AC-341). */
export function validarOrigemUsuarios(nome: string): string {
  if (!PADRAO_ORIGEM_USUARIOS.test(nome)) {
    throw new ErroOrigemUsuariosInvalida(nome);
  }
  return nome;
}

/**
 * Lê os usuários da origem (AC-340). `origem` vem de
 * `SUPABASE_LEGADO_TABELA_USUARIOS` e cai em `auth.users` sem ela; a
 * validação acontece antes de qualquer consulta (AC-341).
 */
export async function lerUsuarios(
  pool: Pool,
  origem: string = process.env[VARIAVEL_AMBIENTE_USUARIOS] || ORIGEM_USUARIOS_PADRAO
): Promise<UsuarioLegado[]> {
  const tabela = validarOrigemUsuarios(origem);
  const { rows } = await pool.query<{
    id: string;
    email: string;
    nome: string;
    perfil: PapelLegado;
    ativo: boolean;
    empresa_id: string;
    is_super_admin: boolean;
  }>(
    `SELECT
       id,
       email,
       coalesce(raw_user_meta_data ->> 'nome', email) AS nome,
       (raw_user_meta_data ->> 'perfil') AS perfil,
       coalesce((raw_user_meta_data ->> 'ativo')::boolean, true) AS ativo,
       (raw_user_meta_data ->> 'empresa_id') AS empresa_id,
       coalesce((raw_user_meta_data ->> 'is_super_admin')::boolean, false) AS is_super_admin
     FROM ${tabela}`
  );
  return rows.map((linha) => ({
    id: linha.id,
    email: linha.email,
    nome: linha.nome,
    perfil: linha.perfil,
    ativo: linha.ativo,
    empresaId: linha.empresa_id,
    isSuperAdmin: linha.is_super_admin,
  }));
}

/** Encerra a conexão com a origem. Seguro chamar mesmo após falha parcial. */
export async function encerrarOrigem(pool: Pool): Promise<void> {
  await pool.end();
}

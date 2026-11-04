// T-026 (fase1-auth-rbac, US-014): instala e configura o Better Auth sobre o
// schema já entregue pela fase1-schema-drizzle (`usuarios`, `contas`,
// `sessoes`, `tokens_verificacao`). O adaptador Drizzle da lib é mapeado
// pelos nomes em português já existentes — nenhuma tabela nova em inglês é
// criada (ASM-011), exceto a coluna `email_verificado` em `usuarios`, exigida
// pelo modelo `user` do Better Auth e ausente do schema original (T-026).
//
// Hash de senha: reaproveita `hashSenha`/`verificarSenha` de T-029 via
// `emailAndPassword.password.{hash,verify}` — o mesmo formato de hash já
// usado por T-028/T-029/T-030 continua válido, então o login por esta lib
// (T-027) reconhece credenciais criadas por elas.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { contas, sessoes, tokensVerificacao, usuarios } from '../../db/schema';
import { hashSenha, verificarSenha } from './definir-senha';
import { DURACAO_DA_SESSAO_SEGUNDOS } from './sessao-config';

/** ID do provedor de credencial — literal exigido pelas rotas internas do Better Auth (sign-in, reset). Nunca traduzir. */
export const PROVEDOR_CREDENCIAL_BETTER_AUTH = 'credential';

export interface CriarAuthOpcoes {
  /** Segredo usado para assinar cookies de sessão. Obrigatório fora de teste. */
  secret?: string;
  /** URL base da aplicação — exigida pelo Better Auth para montar links/redirects. */
  baseURL?: string;
}

/**
 * Cria a instância do Better Auth configurada contra o schema Drizzle desta
 * feature. Recebe `db` (em vez de importar um client global) para que os
 * testes possam apontar para o Postgres efêmero do harness (T-020).
 */
export function criarAuth(db: NodePgDatabase, opcoes: CriarAuthOpcoes = {}) {
  return betterAuth({
    secret: opcoes.secret ?? 'segredo-de-desenvolvimento-nao-usar-em-producao',
    baseURL: opcoes.baseURL ?? 'http://localhost:3000',
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { usuarios, sessoes, contas, tokensVerificacao },
    }),
    user: {
      modelName: 'usuarios',
      fields: {
        name: 'nome',
        emailVerified: 'emailVerificado',
        image: 'imagem',
        createdAt: 'criadoEm',
        updatedAt: 'atualizadoEm',
      },
    },
    session: {
      // Q-006 (spec): sessão expira em 7 dias.
      expiresIn: DURACAO_DA_SESSAO_SEGUNDOS,
      modelName: 'sessoes',
      fields: {
        userId: 'usuarioId',
        expiresAt: 'expiraEm',
        ipAddress: 'enderecoIp',
        createdAt: 'criadoEm',
        updatedAt: 'atualizadoEm',
      },
    },
    account: {
      modelName: 'contas',
      fields: {
        userId: 'usuarioId',
        accountId: 'idConta',
        providerId: 'idProvedor',
        accessToken: 'tokenAcesso',
        refreshToken: 'tokenRefresh',
        idToken: 'tokenId',
        accessTokenExpiresAt: 'tokenAcessoExpiraEm',
        refreshTokenExpiresAt: 'tokenRefreshExpiraEm',
        scope: 'escopo',
        password: 'senha',
        createdAt: 'criadoEm',
        updatedAt: 'atualizadoEm',
      },
    },
    verification: {
      modelName: 'tokensVerificacao',
      fields: {
        value: 'valor',
        expiresAt: 'expiraEm',
        identifier: 'identificador',
        createdAt: 'criadoEm',
        updatedAt: 'atualizadoEm',
      },
    },
    emailAndPassword: {
      enabled: true,
      password: {
        hash: async (senha: string) => hashSenha(senha),
        verify: async ({ hash, password }: { hash: string; password: string }) =>
          verificarSenha(password, hash),
      },
    },
    // AC-047: limite por IP e e-mail em memória (por processo) — 5
    // tentativas / 15 minutos, decidido em Q-005 (spec).
    rateLimit: {
      enabled: true,
      window: 15 * 60,
      max: 5,
      // O Better Auth aplica esse limite a TODA rota de `/api/auth/*`, mas ele foi decidido
      // para tentativas de LOGIN (Q-005). "Sair" só funciona com a sessão válida e não é um
      // vetor de ataque: com o limite, quem clicava em "Sair" umas 5 vezes (inclusive em
      // cliques que falharam) ficava 15 minutos sem conseguir sair (429).
      customRules: {
        '/sign-out': false,
      },
    },
    advanced: {
      // AC-033/TDD-001 §4.7: cookie sempre Secure, mesmo fora de produção —
      // sem isso o default do Better Auth só marca Secure quando `baseURL`
      // é https ou `NODE_ENV=production`.
      useSecureCookies: true,
      database: {
        // Todas as tabelas mapeadas (sessoes/contas/tokens_verificacao) têm
        // `id uuid` — o gerador default do Better Auth produz uma string
        // alfanumérica que não é um UUID válido para o Postgres.
        generateId: 'uuid',
      },
    },
  });
}

export type Auth = ReturnType<typeof criarAuth>;

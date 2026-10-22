// Testes de T-138 (fase3-etl-supabase): origem dos usuários configurável
// (src/etl/supabase/origem.ts). Nenhum teste aqui abre conexão de verdade — o
// `pool` é um dublê que só registra as consultas recebidas.
import { describe, expect, test, vi } from 'vitest';

import {
  ErroOrigemUsuariosInvalida,
  lerUsuarios,
  ORIGEM_USUARIOS_PADRAO,
  VARIAVEL_AMBIENTE_USUARIOS,
} from '../../src/etl/supabase/origem';

function poolFalso(linhas: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows: linhas });
  return { pool: { query } as unknown as Parameters<typeof lerUsuarios>[0], query };
}

const LINHA_USUARIO = {
  id: 'u-1',
  email: 'ana@exemplo.com',
  nome: 'Ana',
  perfil: 'ADMIN',
  ativo: true,
  empresa_id: 'e-1',
  is_super_admin: false,
};

describe('T-138: os usuários podem ser lidos de uma view da origem (@spec:AC-340)', () => {
  test('com a origem etl.usuarios a consulta lê dessa view, com as mesmas colunas de sempre', async () => {
    const { pool, query } = poolFalso([LINHA_USUARIO]);

    const usuarios = await lerUsuarios(pool, 'etl.usuarios');

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/FROM\s+etl\.usuarios\b/);
    expect(sql).not.toMatch(/auth\.users/);
    for (const coluna of ['raw_user_meta_data', 'email', 'id']) {
      expect(sql).toContain(coluna);
    }
    expect(usuarios).toEqual([
      {
        id: 'u-1',
        email: 'ana@exemplo.com',
        nome: 'Ana',
        perfil: 'ADMIN',
        ativo: true,
        empresaId: 'e-1',
        isSuperAdmin: false,
      },
    ]);
  });

  test('sem a variável a leitura continua em auth.users', async () => {
    const anterior = process.env[VARIAVEL_AMBIENTE_USUARIOS];
    delete process.env[VARIAVEL_AMBIENTE_USUARIOS];
    try {
      const { pool, query } = poolFalso();

      await lerUsuarios(pool);

      expect(ORIGEM_USUARIOS_PADRAO).toBe('auth.users');
      expect(String(query.mock.calls[0][0])).toMatch(/FROM\s+auth\.users\b/);
    } finally {
      if (anterior !== undefined) process.env[VARIAVEL_AMBIENTE_USUARIOS] = anterior;
    }
  });

  test('a variável de ambiente define a origem quando nenhuma é passada', async () => {
    const anterior = process.env[VARIAVEL_AMBIENTE_USUARIOS];
    process.env[VARIAVEL_AMBIENTE_USUARIOS] = 'etl.usuarios';
    try {
      const { pool, query } = poolFalso();

      await lerUsuarios(pool);

      expect(String(query.mock.calls[0][0])).toMatch(/FROM\s+etl\.usuarios\b/);
    } finally {
      if (anterior === undefined) delete process.env[VARIAVEL_AMBIENTE_USUARIOS];
      else process.env[VARIAVEL_AMBIENTE_USUARIOS] = anterior;
    }
  });
});

describe('T-138: nome de origem inválido é recusado antes de qualquer consulta (@spec:AC-341)', () => {
  const INVALIDAS = [
    'etl.usuarios; drop table x',
    'etl."usuarios"',
    'etl usuarios',
    'a.b.c',
    "etl.usuarios'--",
    '.usuarios',
    'etl.',
    '1etl.usuarios',
  ];

  test.each(INVALIDAS)('recusa %j, cita a variável e não envia consulta', async (nome) => {
    const { pool, query } = poolFalso();

    await expect(lerUsuarios(pool, nome)).rejects.toBeInstanceOf(ErroOrigemUsuariosInvalida);
    await expect(lerUsuarios(pool, nome)).rejects.toThrow(VARIAVEL_AMBIENTE_USUARIOS);
    expect(query).not.toHaveBeenCalled();
  });

  test('aceita nomes simples e com um schema', async () => {
    for (const nome of ['usuarios', 'etl.usuarios', 'auth.users', 'meu_schema.minha_view_2']) {
      const { pool, query } = poolFalso();
      await lerUsuarios(pool, nome);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });
});

// Gera o link de definir senha (24 h, uso único) de um ou mais usuários, sem depender de e-mail. Uso (na VPS, em container node):
//   npx tsx tmp/links-senha.ts <url-base-do-sistema> <email> [<email> ...]
// Imprime nome, e-mail e o link de cada um. Não vai para a main.
import { randomBytes } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { solicitarResetSenha } from '../src/lib/auth/reset-senha';

async function main() {
  const [base, ...emails] = process.argv.slice(2);
  if (!base || emails.length === 0) throw new Error('uso: links-senha.ts <url-base> <email> [<email> ...]');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  for (const digitado of emails) {
    // a busca do reset é pelo e-mail exato; acha a grafia gravada no banco, qualquer que seja a caixa
    const usuario = (await pool.query('select email, nome from usuarios where lower(email) = lower($1) limit 1', [digitado])).rows[0] as
      | { email: string; nome: string }
      | undefined;
    if (!usuario) {
      console.log(`${digitado}\n  NÃO ENCONTRADO: nenhum usuário com esse e-mail\n`);
      continue;
    }
    const token = randomBytes(32).toString('hex');
    await solicitarResetSenha(db, usuario.email, { gerarToken: () => token });
    console.log(`${usuario.nome} <${usuario.email}>\n  ${base.replace(/\/+$/, '')}/redefinir-senha/${token}\n`);
  }
  await pool.end();
}
main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});

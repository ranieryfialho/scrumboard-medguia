// Define a senha de um usuário direto, sem passar pela API pública /api/acesso (que o middleware está bloqueando).
// Usa o mesmo código da redefinição (valida a política, grava o hash, cria a conta de login se faltar, revoga sessões).
// Uso (na VPS, em container node): NOVA_SENHA vem do ambiente, nunca da linha de comando.
//   npx tsx /app/tmp/definir-senha.ts <email-exato-como-está-no-banco>
// Não vai para a main.
import { randomBytes } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { ErroSenhaFraca } from '../src/lib/auth/politica-senha';
import { resetarSenhaComToken, solicitarResetSenha } from '../src/lib/auth/reset-senha';

async function main() {
  const email = process.argv[2];
  const senha = process.env.NOVA_SENHA ?? '';
  if (!email || !senha) throw new Error('uso: NOVA_SENHA=... definir-senha.ts <email>');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  const token = randomBytes(32).toString('hex');
  try {
    await solicitarResetSenha(db, email, { gerarToken: () => token });
    const r = await resetarSenhaComToken(db, token, senha);
    console.log(`senha definida para ${r.email} (sessões antigas encerradas: ${r.sessoesRevogadas})`);
  } catch (erro) {
    await pool.query('delete from tokens_verificacao where valor = $1', [token]);
    if (erro instanceof ErroSenhaFraca) throw new Error(`senha fora da política: ${erro.criteriosNaoAtendidos.join(', ')}`);
    throw new Error('não deu certo (e-mail exato como está no banco?): ' + (erro as Error).message);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});

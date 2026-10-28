// Fixture compartilhada (fase4-analises): cria um ATENDENTE na empresa A do ambiente
// de `prepararAmbienteAnexos` e devolve o cookie de sessão dele — para provar os 403.
import type { AmbienteAnexos } from './api-anexos';
import { criarAuth } from '../../src/lib/auth/server';
import { convidarUsuario } from '../../src/lib/auth/convites';
import { definirSenhaComToken } from '../../src/lib/auth/definir-senha';

export async function cookieDeAtendente(amb: AmbienteAnexos, email: string): Promise<string> {
  const convite = await convidarUsuario(
    amb.db,
    { usuarioId: 'ffffffff-0000-0000-0000-0000000000f1', empresaId: amb.tenants.empresaA, papel: 'MASTER', isSuperAdmin: false },
    { email, papel: 'ATENDENTE' }
  );
  await definirSenhaComToken(amb.db, convite.token, 'senha-correta-123');
  const resposta = await criarAuth(amb.db).api.signInEmail({ body: { email, password: 'senha-correta-123' }, asResponse: true });
  const cookie = (resposta.headers.getSetCookie?.() ?? []).find((c) => c.includes('better-auth.session_token='));
  if (!cookie) throw new Error('cookie de sessão do atendente não encontrado');
  return cookie.split(';')[0];
}

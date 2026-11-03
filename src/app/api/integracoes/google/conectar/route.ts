// T-301 (fase4-tarefas-agenda, AC-765): `GET /api/integracoes/google/conectar` — começa a conexão: guarda um código de segurança (state) num cookie
// de 10 minutos e manda o gerente para a tela de autorização do Google. Sem as credenciais no servidor volta para a tela com o aviso.
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { configDoGoogle, COOKIE_DO_STATE, urlDeAutorizacao } from '../../../../../lib/google/calendario';
import { baseDaUrl, exigirGerente } from '../../../../../lib/equipe/acesso';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const base = baseDaUrl(request);
  const config = configDoGoogle();
  if (!config) return NextResponse.redirect(`${base}/configuracoes/google?erro=nao_configurado`, 302);

  const state = randomBytes(24).toString('hex');
  const resposta = NextResponse.redirect(urlDeAutorizacao(config, `${base}/api/integracoes/google/callback`, state), 302);
  resposta.cookies.set(COOKIE_DO_STATE, state, { httpOnly: true, sameSite: 'lax', secure: base.startsWith('https://'), maxAge: 600, path: '/api/integracoes/google' });
  return resposta;
}

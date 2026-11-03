// T-301 (fase4-tarefas-agenda, AC-765): `GET /api/integracoes/google/callback` — para onde o Google devolve o gerente. Confere o código de
// segurança (state) do cookie, troca o código pelo refresh token, guarda (cifrado) com o e-mail da conta e volta para a tela de configuração.
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { getDb } from '../../../../../db/client';
import { configDoGoogle, COOKIE_DO_STATE, trocarCodigo } from '../../../../../lib/google/calendario';
import { baseDaUrl, exigirGerente } from '../../../../../lib/equipe/acesso';
import { ErroConfiguracaoIndisponivel } from '../../../../../lib/seguranca/cifra';
import { gravarGoogleConectado } from '../../../../../repositories/google-config';

export const dynamic = 'force-dynamic';

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const base = baseDaUrl(request);
  const volta = (consulta: string) => {
    const r = NextResponse.redirect(`${base}/configuracoes/google?${consulta}`, 302);
    r.cookies.delete({ name: COOKIE_DO_STATE, path: '/api/integracoes/google' });
    return r;
  };

  const p = request.nextUrl.searchParams;
  if (p.get('error')) return volta('erro=negado');
  const state = request.cookies.get(COOKIE_DO_STATE)?.value;
  const recebido = p.get('state');
  const codigo = p.get('code');
  if (!state || !recebido || !iguais(state, recebido) || !codigo) return volta('erro=estado');

  const config = configDoGoogle();
  if (!config) return volta('erro=nao_configurado');
  try {
    const conexao = await trocarCodigo(config, `${base}/api/integracoes/google/callback`, codigo);
    await gravarGoogleConectado(getDb(), acesso.contexto.empresaId, conexao);
  } catch (erro) {
    return volta(erro instanceof ErroConfiguracaoIndisponivel ? 'erro=segredo' : 'erro=falha');
  }
  return volta('conectado=1');
}

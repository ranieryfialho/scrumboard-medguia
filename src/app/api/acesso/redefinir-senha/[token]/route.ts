// T-145 (fase4-design-system-shell-acesso, US-101): GET valida o token de
// redefinição sem consumi-lo (AC-370 — abrir a página não gasta o token,
// só um SELECT); POST aplica a política de senha (T-141), troca a
// credencial e já cria uma sessão nova (ASM-126), do mesmo jeito que o
// login comum (`auth.api.signInEmail`).
import { and, eq, gt } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { tokensVerificacao } from '../../../../../db/schema';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSenhaFraca } from '../../../../../lib/auth/politica-senha';
import { ErroTokenResetInvalido, identificadorReset, resetarSenhaComToken } from '../../../../../lib/auth/reset-senha';

export const dynamic = 'force-dynamic';

const PREFIXO_RESET = identificadorReset('');

function tokenInvalidoResposta() {
  // AC-370: mesmo erro genérico para token expirado, inexistente ou já usado.
  return NextResponse.json({ codigo: 'TOKEN_INVALIDO' }, { status: 404 });
}

async function tokenValido(token: string): Promise<boolean> {
  const [registro] = await getDb()
    .select({ identificador: tokensVerificacao.identificador })
    .from(tokensVerificacao)
    .where(and(eq(tokensVerificacao.valor, token), gt(tokensVerificacao.expiraEm, new Date())))
    .limit(1);

  return !!registro && registro.identificador.startsWith(PREFIXO_RESET);
}

/** AC-370: só diz se o token ainda é válido — nunca o consome (sem DELETE). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await tokenValido(token))) return tokenInvalidoResposta();
  return NextResponse.json({ valido: true });
}

/**
 * AC-369: senha dentro da política troca a credencial, revoga sessões
 * antigas e consome o token (`resetarSenhaComToken`), e já cria uma sessão
 * nova, pronta para o navegador ir para `/pipeline`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const corpo = await request.json().catch(() => null);
  const senha = typeof corpo?.senha === 'string' ? corpo.senha : '';

  let resultado;
  try {
    resultado = await resetarSenhaComToken(getDb(), token, senha);
  } catch (erro) {
    if (erro instanceof ErroTokenResetInvalido) return tokenInvalidoResposta();
    if (erro instanceof ErroSenhaFraca) {
      return NextResponse.json({ codigo: erro.codigo, criterios: erro.criteriosNaoAtendidos }, { status: 400 });
    }
    throw erro;
  }

  const sessaoResposta = await getAuth().api.signInEmail({
    body: { email: resultado.email, password: senha },
    asResponse: true,
  });

  const resposta = NextResponse.json({ ok: true });
  for (const cookie of sessaoResposta.headers.getSetCookie()) {
    resposta.headers.append('set-cookie', cookie);
  }
  return resposta;
}

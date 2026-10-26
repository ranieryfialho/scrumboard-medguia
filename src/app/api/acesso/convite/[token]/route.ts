// T-145 (fase4-design-system-shell-acesso, US-102): GET mostra para quem é
// o convite sem consumi-lo (AC-371), ou o erro genérico sem vazar dados da
// empresa (AC-374); POST ativa a conta — aplica a política de senha
// (T-141), grava o nome informado (ASM-127) e já cria a sessão (ASM-126).
import { and, eq, gt } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { empresas, empresasUsuarios, tokensVerificacao, usuarios } from '../../../../../db/schema';
import { identificadorConvite } from '../../../../../lib/auth/convites';
import { definirSenhaComToken, ErroTokenConviteInvalido } from '../../../../../lib/auth/definir-senha';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSenhaFraca, validarSenha } from '../../../../../lib/auth/politica-senha';

export const dynamic = 'force-dynamic';

const PREFIXO_CONVITE = identificadorConvite('');

function conviteInvalidoResposta() {
  // AC-374: erro genérico, sem nome de empresa, de administrador nem e-mail.
  return NextResponse.json({ codigo: 'CONVITE_INVALIDO' }, { status: 404 });
}

interface ConviteValido {
  email: string;
  papel: string;
  empresa: { id: string; nome: string };
}

async function resolverConvite(token: string): Promise<ConviteValido | null> {
  const db = getDb();
  const [registro] = await db
    .select({ identificador: tokensVerificacao.identificador })
    .from(tokensVerificacao)
    .where(and(eq(tokensVerificacao.valor, token), gt(tokensVerificacao.expiraEm, new Date())))
    .limit(1);

  if (!registro || !registro.identificador.startsWith(PREFIXO_CONVITE)) return null;

  const email = registro.identificador.slice(PREFIXO_CONVITE.length);
  const [usuario] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
  if (!usuario) return null;

  const [vinculo] = await db
    .select({ papel: empresasUsuarios.papel, empresaId: empresas.id, empresaNome: empresas.nome })
    .from(empresasUsuarios)
    .innerJoin(empresas, eq(empresas.id, empresasUsuarios.empresaId))
    .where(eq(empresasUsuarios.usuarioId, usuario.id))
    .limit(1);
  if (!vinculo) return null;

  return {
    email,
    papel: vinculo.papel,
    empresa: { id: vinculo.empresaId, nome: vinculo.empresaNome },
  };
}

/** AC-371/AC-374: mostra para quem é o convite, ou o erro genérico sem vazar dados. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const convite = await resolverConvite(token);
  if (!convite) return conviteInvalidoResposta();
  return NextResponse.json({ valido: true, ...convite });
}

/** AC-373: ativar cria a senha, grava o nome informado e já entra. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const corpo = await request.json().catch(() => null);
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';
  const senha = typeof corpo?.senha === 'string' ? corpo.senha : '';

  try {
    validarSenha(senha);
  } catch (erro) {
    if (erro instanceof ErroSenhaFraca) {
      return NextResponse.json({ codigo: erro.codigo, criterios: erro.criteriosNaoAtendidos }, { status: 400 });
    }
    throw erro;
  }

  let resultado;
  try {
    resultado = await definirSenhaComToken(getDb(), token, senha, nome ? { nome } : {});
  } catch (erro) {
    if (erro instanceof ErroTokenConviteInvalido) return conviteInvalidoResposta();
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

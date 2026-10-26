// T-145 (fase4-design-system-shell-acesso, US-100): rota de "esqueci minha
// senha" — resposta idêntica para e-mail cadastrado ou não (AC-364) e envio
// de e-mail (T-142) só quando a conta existe e está ativa (AC-365). Usa o
// mesmo módulo de limite de tentativas de AC-047 (`rate-limit.ts`), para não
// permitir spam de pedidos pelo mesmo e-mail ou IP.
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { tokensVerificacao, usuarios } from '../../../../db/schema';
import {
  ErroLimiteTaxaExcedido,
  LimitadorTaxa,
  registrarFalha,
  verificarLimite,
} from '../../../../lib/auth/rate-limit';
import { identificadorReset, solicitarResetSenha } from '../../../../lib/auth/reset-senha';
import { enviarEmailRedefinicaoSenha } from '../../../../lib/email/enviar';

export const dynamic = 'force-dynamic';

// Em memória de processo — um limitador só, reaproveitado entre requisições
// (mesmo espírito do rate limit do Better Auth em server.ts).
const limitador = new LimitadorTaxa();

function enderecoIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconhecido';
}

/**
 * AC-364/AC-365: sempre responde `{ solicitado: true }`, exista ou não a
 * conta — só o efeito colateral (token gerado, e-mail enviado) difere.
 */
export async function POST(request: NextRequest) {
  const corpo = await request.json().catch(() => null);
  const email = typeof corpo?.email === 'string' ? corpo.email : '';
  const ip = enderecoIp(request);

  try {
    verificarLimite(limitador, 'reset', email, ip);
  } catch (erro) {
    if (erro instanceof ErroLimiteTaxaExcedido) {
      return NextResponse.json({ codigo: 'LIMITE_EXCEDIDO' }, { status: 429 });
    }
    throw erro;
  }
  registrarFalha(limitador, 'reset', email, ip);

  const db = getDb();
  const resultado = await solicitarResetSenha(db, email);

  // AC-365: o transporte real (Resend) pode falhar por configuração ausente
  // (Q-043, deliberadamente sem chave em staging) — isso nunca pode mudar a
  // resposta observável (AC-364), só o envio em si falha silenciosamente.
  try {
    const existeEAtivo = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.email, email), eq(usuarios.ativo, true)))
      .limit(1);

    if (existeEAtivo[0]) {
      const [tokenRecente] = await db
        .select({ valor: tokensVerificacao.valor })
        .from(tokensVerificacao)
        .where(eq(tokensVerificacao.identificador, identificadorReset(email)))
        .orderBy(desc(tokensVerificacao.criadoEm))
        .limit(1);

      await enviarEmailRedefinicaoSenha(email, tokenRecente?.valor ?? null);
    } else {
      await enviarEmailRedefinicaoSenha(email, null);
    }
  } catch {
    // Envio indisponível (ex.: RESEND_API_KEY ausente) — não afeta a resposta.
  }

  return NextResponse.json(resultado);
}

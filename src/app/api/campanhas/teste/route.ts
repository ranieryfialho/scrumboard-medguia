// T-306 (fase4-campanhas, US-130): `POST /api/campanhas/teste` — manda o e-mail em edição só para quem está logado, com a chave e o
// remetente da empresa, para ver o HTML na caixa de entrada de verdade. Não cria campanha nem destinatário. 400 sem assunto/corpo,
// 409 sem chave do Resend, 502 se o Resend recusar. Gerente, master e super admin (mesma regra das campanhas).
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { usuarios } from '../../../../db/schema';
import { transporteResendDeCampanha } from '../../../../lib/email/campanha-envio';
import { renderizarCorpoDeCampanha } from '../../../../lib/email/campanha-corpo';
import { exigirAcessoACampanhas } from '../../../../lib/campanhas/acesso';
import { lerConfiguracaoDeEmail } from '../../../../repositories/email-config';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const acesso = await exigirAcessoACampanhas(request);
  if ('resposta' in acesso) return acesso.resposta;
  const { contexto } = acesso;

  const corpo = (await request.json().catch(() => null)) as { assunto?: unknown; corpoHtml?: unknown } | null;
  const assunto = typeof corpo?.assunto === 'string' ? corpo.assunto.trim() : '';
  const corpoHtml = typeof corpo?.corpoHtml === 'string' ? corpo.corpoHtml : '';
  if (!assunto || !corpoHtml.trim() || assunto.length > 300 || corpoHtml.length > 2_000_000) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });

  const db = getDb();
  const [usuario] = await db.select({ nome: usuarios.nome, email: usuarios.email }).from(usuarios).where(eq(usuarios.id, contexto.usuarioId)).limit(1);
  if (!usuario) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });

  const config = await lerConfiguracaoDeEmail(db, contexto.empresaId);
  if (!config) return NextResponse.json({ codigo: 'CHAVE_RESEND_NAO_CONFIGURADA' }, { status: 409 });

  const resultado = await transporteResendDeCampanha({
    apiKey: config.apiKey,
    remetente: config.remetente,
    replyTo: config.replyTo ?? null,
    destinatario: usuario.email,
    assunto: `[TESTE] ${assunto}`,
    html: renderizarCorpoDeCampanha(corpoHtml, usuario.nome),
    cabecalhos: {},
    envioId: 'teste',
    empresaId: contexto.empresaId,
  });
  if (!resultado.ok) return NextResponse.json({ codigo: 'FALHA_ENVIO' }, { status: 502 });
  return NextResponse.json({ ok: true, para: usuario.email });
}

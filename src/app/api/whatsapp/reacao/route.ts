// POST /api/whatsapp/reacao — a empresa reage (ou tira a reação) a uma mensagem da conversa, como no WhatsApp.
// Ordem, no mesmo molde de `send`: sessão (401) → corpo (400) → mensagem do tenant com id da Evolution (404) → instância (409) →
// Evolution fora da transação do banco (502) → grava a reação `nos` e avisa a conversa aberta.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buildConfig, sendReaction } from '../../../../lib/evolution-api';
import { buscarMensagemParaReacao, registrarReacao } from '../../../../repositories/whatsapp';
import { buscarNomeInstancia } from '../../../../repositories/whatsapp-instancia';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Um emoji só (pode ter modificador de tom de pele, ZWJ, bandeira...); vazio tira a reação. Limite folgado de caracteres, sem listar emojis.
const EMOJI_MAX = 16;
const TEM_EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|[#*0-9]️?⃣/u;

async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;
  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

const erro = (codigo: string, status: number) => NextResponse.json({ codigo }, { status });

export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return erro('NAO_AUTENTICADO', 401);

  const corpo = (await request.json().catch(() => null)) as { mensagemId?: unknown; emoji?: unknown } | null;
  const mensagemId = corpo?.mensagemId;
  const emoji = typeof corpo?.emoji === 'string' ? corpo.emoji.trim() : null;
  if (typeof mensagemId !== 'string' || !UUID.test(mensagemId)) return erro('REQUISICAO_INVALIDA', 400);
  if (emoji === null || emoji.length > EMOJI_MAX || (emoji !== '' && !TEM_EMOJI.test(emoji))) return erro('REQUISICAO_INVALIDA', 400);

  const db = getDb();
  const mensagem = await buscarMensagemParaReacao(db, contexto, mensagemId);
  if (!mensagem) return erro('MENSAGEM_NAO_ENCONTRADA', 404);

  const nomeInstancia = await buscarNomeInstancia(db, contexto);
  if (!nomeInstancia) return erro('WHATSAPP_NAO_CONFIGURADO', 409);

  const aceita = await sendReaction(
    buildConfig(nomeInstancia),
    { remoteJid: `${mensagem.numero}@s.whatsapp.net`, fromMe: mensagem.direcao === 'enviada', id: mensagem.evolutionMessageId },
    emoji
  );
  if (!aceita) return erro('FALHA_ENVIO', 502);

  await registrarReacao(db, contexto, { evolutionMessageId: mensagem.evolutionMessageId, autor: 'nos', emoji });
  return NextResponse.json({ success: true });
}

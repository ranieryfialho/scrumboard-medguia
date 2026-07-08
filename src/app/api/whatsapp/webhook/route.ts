import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// A Evolution API envia POST para: /api/whatsapp/webhook?empresa_id=XXX&secret=YYY
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const empresaId = searchParams.get('empresa_id');
  const secret = searchParams.get('secret');

  if (!empresaId) {
    return NextResponse.json({ error: 'empresa_id obrigatório' }, { status: 400 });
  }

  // Valida o secret configurado para a empresa
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: secretRow } = await admin
    .from('empresa_configuracoes')
    .select('valor')
    .eq('empresa_id', empresaId)
    .eq('chave', 'evolution_webhook_secret')
    .single();

  if (secretRow?.valor && secretRow.valor !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Processa apenas eventos de mensagem
  const event = (payload?.event as string | undefined)?.toLowerCase() || '';
  console.log('[webhook] evento recebido:', event);
  if (!event.includes('messages')) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Suporte a payload único e array (Evolution API pode enviar ambos)
  const dataItems: any[] = Array.isArray(payload?.data)
    ? payload.data
    : payload?.data
      ? [payload.data]
      : [];

  let inserido = false;
  for (const item of dataItems) {
    const fromMe = item?.key?.fromMe ?? false;
    if (fromMe) continue; // ignora enviadas por nós

    // Prioriza remoteJidAlt (número real) sobre remoteJid (pode ser ID de device)
    const remoteJid: string = item?.key?.remoteJidAlt || item?.key?.remoteJid || '';

    // Ignora grupos
    if (remoteJid.includes('@g.us')) continue;

    // Extrai apenas o número, descartando o sufixo de device (:2, :8, etc.)
    // Ex: "558599985587@s.whatsapp.net" → "558599985587"
    const numero = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!numero) continue;

    const msgData = item?.message || item;
    const mensagem =
      msgData?.conversation ||
      msgData?.extendedTextMessage?.text ||
      msgData?.imageMessage?.caption ||
      msgData?.videoMessage?.caption ||
      msgData?.documentMessage?.caption ||
      (msgData?.audioMessage ? '[áudio]' : null) ||
      (msgData?.stickerMessage ? '[figurinha]' : null) ||
      '[mídia]';

    const evolutionMessageId = item?.key?.id || null;

    await admin.from('whatsapp_mensagens').insert({
      empresa_id: empresaId,
      lead_id: null,
      numero,
      mensagem,
      direcao: 'recebida',
      evolution_message_id: evolutionMessageId,
    }).then(({ error }) => {
      // Ignora duplicatas (mesmo message_id já salvo)
      if (error && error.code !== '23505') {
        console.error('[webhook] erro ao inserir mensagem:', error.message);
      }
    });
    inserido = true;
  }

  return NextResponse.json({ ok: true, inserido });
}

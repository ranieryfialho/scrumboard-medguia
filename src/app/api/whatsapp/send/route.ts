import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendTextMessage } from '@/lib/evolution-api';
import { getEmpresaConfig, extractEmpresaId } from '@/lib/evolution-server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { numero, mensagem, leadId } = await request.json();
  if (!numero || !mensagem) {
    return NextResponse.json({ error: 'numero e mensagem são obrigatórios' }, { status: 400 });
  }

  const empresaId = extractEmpresaId(
    user.user_metadata,
    request.headers.get('cookie') || ''
  );
  if (!empresaId) return NextResponse.json({ error: 'empresa_id não encontrado' }, { status: 400 });

  const config = await getEmpresaConfig(empresaId);
  if (!config) return NextResponse.json({ error: 'Instância WhatsApp não configurada' }, { status: 400 });

  // Normaliza para o formato com DDI 55 (consistente com o que a Evolution API usa no webhook)
  const raw = numero.replace(/\D/g, '');
  const numeroNormalizado = raw.startsWith('55') && raw.length >= 12 ? raw : `55${raw}`;

  const result = await sendTextMessage(config, numeroNormalizado, mensagem);

  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await admin.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    lead_id: leadId || null,
    numero: numeroNormalizado,
    mensagem,
    direcao: 'enviada',
    evolution_message_id: result.key?.id || null,
  });

  return NextResponse.json({ success: true, messageId: result.key?.id });
}

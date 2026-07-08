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

  const raw = numero.replace(/\D/g, '');
  // Só adiciona DDI 55 para números brasileiros sem código de país (10 ou 11 dígitos)
  const candidatos = raw.length === 10 || raw.length === 11
    ? [`55${raw}`]
    : raw.length >= 15
      // Número longo pode ter device ID colado pelo webhook antigo — tenta remover 1 e 2 dígitos
      ? [raw, raw.slice(0, -1), raw.slice(0, -2)]
      : [raw];

  let result = await sendTextMessage(config, candidatos[0], mensagem);
  let numeroEnviado = candidatos[0];

  // Retry automático quando o número não é encontrado (device ID colado pelo webhook antigo)
  if (result.numberNotFound && candidatos.length > 1) {
    for (let i = 1; i < candidatos.length; i++) {
      const tentativa = await sendTextMessage(config, candidatos[i], mensagem);
      if (!tentativa.error) {
        result = tentativa;
        numeroEnviado = candidatos[i];
        break;
      }
      if (!tentativa.numberNotFound) break; // erro diferente, para de tentar
    }
  }

  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await admin.from('whatsapp_mensagens').insert({
    empresa_id: empresaId,
    lead_id: leadId || null,
    numero: numeroEnviado,
    mensagem,
    direcao: 'enviada',
    evolution_message_id: result.key?.id || null,
  });

  return NextResponse.json({ success: true, messageId: result.key?.id });
}

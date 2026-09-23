import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createInstance, setWebhook, getQRCode, getInstanceStatus } from '@/lib/evolution-api';
import { getEmpresaConfig, extractEmpresaId } from '@/lib/evolution-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const empresaId = extractEmpresaId(
    user.user_metadata,
    request.headers.get('cookie') || ''
  );
  if (!empresaId) return NextResponse.json({ error: 'empresa_id não encontrado' }, { status: 400 });

  const config = await getEmpresaConfig(empresaId);

  // Apenas verifica o status (sem criar instância)
  const { searchParams } = new URL(request.url);
  if (searchParams.get('action') === 'status') {
    if (!config) return NextResponse.json({ state: 'not_configured' });
    const status = await getInstanceStatus(config);
    const state = status?.instance?.state || status?.state || 'close';
    return NextResponse.json({ state, instance: config.instance });
  }

  if (!config) {
    return NextResponse.json({ error: 'Defina o nome da instância antes de conectar.' }, { status: 400 });
  }

  // Fluxo completo: cria instância → configura webhook → retorna QR
  try {
    await createInstance(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Configura webhook automaticamente
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`;
  const webhookUrl = `${appUrl}/api/whatsapp/webhook?empresa_id=${empresaId}`;
  await setWebhook(config, webhookUrl).catch(() => { /* não bloqueia o QR se falhar */ });

  const result = await getQRCode(config);
  return NextResponse.json(result);
}

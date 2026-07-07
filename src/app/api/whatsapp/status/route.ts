import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getInstanceStatus } from '@/lib/evolution-api';
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
  if (!config) return NextResponse.json({ state: 'not_configured', instance: null });

  const status = await getInstanceStatus(config);
  const state = status?.instance?.state || status?.state || 'close';
  return NextResponse.json({ state, instance: config.instance });
}

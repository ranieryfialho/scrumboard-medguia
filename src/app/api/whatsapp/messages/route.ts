import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { extractEmpresaId } from '@/lib/evolution-server';

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

  const { searchParams } = new URL(request.url);
  const rawNumero = searchParams.get('numero')?.replace(/\D/g, '') || '';

  if (!rawNumero) return NextResponse.json({ mensagens: [] });

  // Normaliza para o formato com DDI 55 (igual ao que a Evolution API envia no webhook)
  const numero = rawNumero.startsWith('55') && rawNumero.length >= 12
    ? rawNumero
    : `55${rawNumero}`;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Busca tanto no formato com quanto sem o 55 para cobrir mensagens antigas
  const { data, error } = await admin
    .from('whatsapp_mensagens')
    .select('id, mensagem, direcao, created_at, numero, status')
    .eq('empresa_id', empresaId)
    .or(`numero.eq.${numero},numero.eq.${rawNumero}`)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ mensagens: data || [] });
}

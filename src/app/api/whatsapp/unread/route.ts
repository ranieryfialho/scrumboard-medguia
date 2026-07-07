import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { extractEmpresaId } from '@/lib/evolution-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ conversas: [] });

  const empresaId = extractEmpresaId(
    user.user_metadata,
    request.headers.get('cookie') || ''
  );
  if (!empresaId) return NextResponse.json({ conversas: [] });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await admin
    .from('whatsapp_mensagens')
    .select('numero, mensagem, created_at')
    .eq('empresa_id', empresaId)
    .eq('direcao', 'recebida')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  // Agrupa por numero — mantém só a mensagem mais recente por conversa
  const map = new Map<string, { numero: string; lastMessage: string; lastAt: string; count: number }>();
  for (const row of data || []) {
    if (!map.has(row.numero)) {
      map.set(row.numero, { numero: row.numero, lastMessage: row.mensagem, lastAt: row.created_at, count: 1 });
    } else {
      map.get(row.numero)!.count++;
    }
  }

  return NextResponse.json({ conversas: Array.from(map.values()) });
}

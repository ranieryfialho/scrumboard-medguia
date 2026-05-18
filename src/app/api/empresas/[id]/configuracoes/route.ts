import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

async function requireSuperAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.user_metadata?.is_super_admin) return null;
  return user;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  const { id } = await params;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await admin
    .from('empresa_configuracoes')
    .select('chave, valor')
    .eq('empresa_id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = (data || []).reduce((acc: Record<string, string>, row) => {
    acc[row.chave] = row.valor;
    return acc;
  }, {});

  return NextResponse.json(config);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  const { id } = await params;
  const config: Record<string, string> = await request.json();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const upserts = Object.entries(config)
    .filter(([, valor]) => valor !== undefined && valor !== '')
    .map(([chave, valor]) => ({
      empresa_id: id,
      chave,
      valor,
    }));

  if (upserts.length === 0) return NextResponse.json({ success: true });

  const { error } = await admin
    .from('empresa_configuracoes')
    .upsert(upserts, { onConflict: 'empresa_id,chave' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

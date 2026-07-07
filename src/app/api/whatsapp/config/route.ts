import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { extractEmpresaId } from '@/lib/evolution-server';

export const dynamic = 'force-dynamic';

const ALLOWED_KEYS = [
  'evolution_instance_name',
  'evolution_auto_msg_em_contato',
  'evolution_auto_msg_recontato',
  'evolution_auto_msg_reuniao_agendada',
  'evolution_auto_msg_aguardando_ativacao',
  'evolution_auto_msg_logins_ativados',
];

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const empresaId = extractEmpresaId(
    user.user_metadata,
    request.headers.get('cookie') || ''
  );
  if (!empresaId) return NextResponse.json({ error: 'empresa_id não encontrado' }, { status: 400 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await admin
    .from('empresa_configuracoes')
    .select('chave, valor')
    .eq('empresa_id', empresaId)
    .in('chave', ALLOWED_KEYS);

  const config = (data || []).reduce((acc: Record<string, string>, r) => {
    acc[r.chave] = r.valor;
    return acc;
  }, {});

  return NextResponse.json({ empresaId, config });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const empresaId = extractEmpresaId(
    user.user_metadata,
    request.headers.get('cookie') || ''
  );
  if (!empresaId) return NextResponse.json({ error: 'empresa_id não encontrado' }, { status: 400 });

  const body: Record<string, string> = await request.json();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verifica conflito de nome de instância com outro tenant
  if (body.evolution_instance_name) {
    const novoNome = body.evolution_instance_name.trim();
    const { data: conflito } = await admin
      .from('empresa_configuracoes')
      .select('empresa_id')
      .eq('chave', 'evolution_instance_name')
      .eq('valor', novoNome)
      .neq('empresa_id', empresaId)
      .maybeSingle();

    if (conflito) {
      return NextResponse.json(
        { error: `O nome "${novoNome}" já está em uso por outra empresa. Escolha um nome diferente.` },
        { status: 409 }
      );
    }
  }

  const upserts = Object.entries(body)
    .filter(([chave]) => ALLOWED_KEYS.includes(chave))
    .map(([chave, valor]) => ({ empresa_id: empresaId, chave, valor }));

  if (upserts.length > 0) {
    const { error } = await admin
      .from('empresa_configuracoes')
      .upsert(upserts, { onConflict: 'empresa_id,chave' });

    // Captura violação do unique index do banco como fallback
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `O nome "${body.evolution_instance_name}" já está em uso. Escolha um nome diferente.` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

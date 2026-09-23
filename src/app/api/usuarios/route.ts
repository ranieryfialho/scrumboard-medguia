import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getErrorMessage } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function getEmpresaId(request: NextRequest): Promise<string | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (user.user_metadata?.is_super_admin) {
    const selectedId = request.cookies.get('selected_empresa_id')?.value;
    if (selectedId) return selectedId;
  }

  return user.user_metadata?.empresa_id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const empresaId = await getEmpresaId(request);
    if (!empresaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw error;

    const usuarios = data.users
      .filter(u => u.user_metadata?.empresa_id === empresaId)
      .map(user => ({
        id: user.id,
        email: user.email,
        nome: user.user_metadata?.nome || 'Sem Nome',
        perfil: user.user_metadata?.perfil || 'Indefinido',
        modulos: user.user_metadata?.modulos || [],
        ativo: user.user_metadata?.ativo !== false,
        criado_em: user.created_at,
      }));

    return NextResponse.json(usuarios);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const empresaId = await getEmpresaId(request);
    if (!empresaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await request.json();
    const { email, nome, perfil, modulos } = body;

    // Super admin pode convidar para qualquer empresa via empresa_id_override
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const finalEmpresaId = (user?.user_metadata?.is_super_admin && body.empresa_id_override)
      ? body.empresa_id_override
      : empresaId;

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        nome,
        perfil,
        modulos,
        ativo: true,
        empresa_id: finalEmpresaId,
      },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/nova-senha`
    });

    if (error) throw error;

    return NextResponse.json({ success: true, user: data.user });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { id, nome, perfil, modulos, ativo } = await request.json();

    if (!id) throw new Error("ID do usuário não fornecido");

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      user_metadata: {
        nome,
        perfil,
        modulos,
        ativo,
      }
    });

    if (error) throw error;

    return NextResponse.json({ success: true, user: data.user });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}

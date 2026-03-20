import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    
    if (error) throw error;

    const usuarios = data.users.map(user => ({
      id: user.id,
      email: user.email,
      nome: user.user_metadata?.nome || 'Sem Nome',
      perfil: user.user_metadata?.perfil || 'Indefinido',
      modulos: user.user_metadata?.modulos || [],
      ativo: user.user_metadata?.ativo !== false,
      criado_em: user.created_at,
    }));

    return NextResponse.json(usuarios);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { email, nome, perfil, modulos } = await req.json();

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        nome,
        perfil,
        modulos,
        ativo: true
      },
      redirectTo: 'https://scrumboard-medguia.vercel.app/nova-senha'
    });

    if (error) throw error;

    return NextResponse.json({ success: true, user: data.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { id, nome, perfil, modulos, ativo } = await req.json();

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
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
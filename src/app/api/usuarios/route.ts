import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 1. A MÁGICA DO CACHE: Força o Next.js a buscar dados novos sempre e não travar no Erro 500
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 2. Cria o cliente DENTRO da função para garantir a leitura correta das chaves na Vercel
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
      perfil: user.user_metadata?.perfil || 'ATENDENTE',
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

    const { email, nome, perfil } = await req.json();

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        nome,
        perfil,
      },
      // 3. O PULO DO GATO: Força o link do e-mail a abrir na tela exata de criar a senha
      redirectTo: 'https://scrumboard-medguia.vercel.app/nova-senha'
    });

    if (error) throw error;

    return NextResponse.json({ success: true, user: data.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
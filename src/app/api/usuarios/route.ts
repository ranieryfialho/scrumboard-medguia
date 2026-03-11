import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Usamos o Admin Client (com a chave secreta) para poder listar e criar usuários ignorando as regras normais de segurança
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// FUNÇÃO PARA LISTAR OS USUÁRIOS NA TABELA
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    
    if (error) throw error;

    // Formata os dados para o frontend ler mais fácil
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

// FUNÇÃO PARA CONVIDAR UM NOVO USUÁRIO POR E-MAIL
export async function POST(req: Request) {
  try {
    const { email, nome, perfil } = await req.json();

    // Usamos a função nativa de CONVITE do Supabase
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        nome,
        perfil, // O Supabase salva isso automaticamente no user_metadata
      }
    });

    if (error) throw error;

    return NextResponse.json({ success: true, user: data.user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
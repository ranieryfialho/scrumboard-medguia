import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; 
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, data } = body;

    const tags = data?.tags || [];
    const envioIdTag = tags.find((t: any) => t.name === 'envio_id');
    const envioId = envioIdTag ? envioIdTag.value : null;

    if (!envioId) {
      return NextResponse.json({ message: 'Ignorado: Sem envio_id' }, { status: 200 });
    }

    if (type === 'email.opened') {
      // Atualiza para ABERTO, mas SÓ SE o status atual for ENVIADO (para não rebaixar um CLICADO acidentalmente)
      await supabase.from('envios_campanha')
        .update({ status: 'ABERTO' })
        .eq('id', envioId)
        .eq('status', 'ENVIADO');
        
    } else if (type === 'email.clicked') {
      // Se clicou, é o nível máximo, atualiza sem restrições
      await supabase.from('envios_campanha')
        .update({ status: 'CLICADO' })
        .eq('id', envioId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro no Webhook do Resend:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
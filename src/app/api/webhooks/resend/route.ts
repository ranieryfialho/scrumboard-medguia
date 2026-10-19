// T-106 (fase2d-campanhas, US-067): webhook do Resend no modelo novo —
// substitui a versão legada (createClient de '@supabase/supabase-js' com a
// chave de serviço). Sem sessão de usuário (como o webhook da Evolution,
// src/app/api/whatsapp/webhook): a assinatura Svix (ASM-079) é a única
// autenticação (AC-247), e a empresa vem das tags do próprio evento — o
// motor em Python (fora de escopo) tagueia cada envio com `envio_id` *e*
// `empresa_id` ao disparar, porque o RLS (0001) nunca é bypassado aqui
// (nenhuma função SECURITY DEFINER faz isso no projeto — todas rodam com os
// privilégios de quem chama) e por isso o UPDATE precisa do `app.empresa_id`
// certo antes de tocar `envios_campanha`. Evento sem `envio_id`, sem
// `empresa_id` válido, de tipo não tratado, ou cujo `envio_id` não bate
// nenhuma linha (empresa errada ou id inexistente) — tudo isso é "ignorado
// com 200" (AC-248): o UPDATE condicional por `id` + `empresa_id` + status
// de origem simplesmente afeta zero linhas, sem precisar distinguir os
// casos.
import { NextResponse, type NextRequest } from 'next/server';

import { and, eq, inArray } from 'drizzle-orm';

import { getDb } from '../../../../db/client';
import { enviosCampanha } from '../../../../db/schema';
import { verificarAssinaturaResend } from '../../../../lib/resend/assinatura';
import { comTenant } from '../../../../repositories/contexto';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assinaturaInvalida() {
  return NextResponse.json({ codigo: 'ASSINATURA_INVALIDA' }, { status: 401 });
}

function ignorado() {
  return NextResponse.json({ ok: true, ignorado: true }, { status: 200 });
}

interface TagResend {
  name?: string;
  value?: string;
}

function valorDaTag(tags: TagResend[] | undefined, nome: string): string | null {
  if (!Array.isArray(tags)) return null;
  const tag = tags.find((item) => item && item.name === nome);
  return typeof tag?.value === 'string' ? tag.value : null;
}

export async function POST(request: NextRequest) {
  const corpoCru = await request.text();

  const assinaturaValida = verificarAssinaturaResend(process.env.RESEND_WEBHOOK_SECRET, corpoCru, {
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
  });
  if (!assinaturaValida) return assinaturaInvalida();

  let evento: { type?: string; data?: { tags?: TagResend[] } } | null = null;
  try {
    evento = JSON.parse(corpoCru);
  } catch {
    evento = null;
  }
  if (!evento || typeof evento !== 'object') return ignorado();

  const tipo = evento.type;
  if (tipo !== 'email.opened' && tipo !== 'email.clicked') return ignorado();

  const envioId = valorDaTag(evento.data?.tags, 'envio_id');
  const empresaId = valorDaTag(evento.data?.tags, 'empresa_id');
  if (!envioId || !UUID.test(envioId) || !empresaId || !UUID.test(empresaId)) return ignorado();

  const db = getDb();

  await comTenant(db, { empresaId }, async (tx) => {
    if (tipo === 'email.opened') {
      // AC-246: abertura leva ENVIADO a ABERTO; nunca rebaixa um CLICADO —
      // por isso o status de origem exigido é só `ENVIADO`.
      await tx
        .update(enviosCampanha)
        .set({ status: 'ABERTO' })
        .where(
          and(
            eq(enviosCampanha.id, envioId),
            eq(enviosCampanha.empresaId, empresaId),
            eq(enviosCampanha.status, 'ENVIADO')
          )
        );
    } else {
      // AC-246: clique leva ENVIADO ou ABERTO a CLICADO.
      await tx
        .update(enviosCampanha)
        .set({ status: 'CLICADO' })
        .where(
          and(
            eq(enviosCampanha.id, envioId),
            eq(enviosCampanha.empresaId, empresaId),
            inArray(enviosCampanha.status, ['ENVIADO', 'ABERTO'])
          )
        );
    }
  });

  return NextResponse.json({ ok: true });
}

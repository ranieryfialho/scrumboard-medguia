// T-074 (fase2c-whatsapp-conversa, US-047): DELETE
// /api/leads/:id/telefones/:telefoneId — remove um telefone extra do lead.
// Nunca remove o principal (ele não existe nesta tabela). `id`/`telefoneId`
// que nem são uuid, de outro lead ou de outra empresa: mesmo 404, nada
// apagado (AC-163/AC-164).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../../db/client';
import { getAuth } from '../../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../../lib/auth/tenant';
import { removerTelefoneLead } from '../../../../../../repositories/lead-telefones';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

function telefoneNaoEncontrado() {
  return NextResponse.json({ codigo: 'TELEFONE_NAO_ENCONTRADO' }, { status: 404 });
}

/** AC-163/AC-164: remove só o extra do próprio lead e tenant. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; telefoneId: string }> }
) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id: leadId, telefoneId } = await params;
  if (!UUID.test(leadId) || !UUID.test(telefoneId)) return telefoneNaoEncontrado();

  const removeu = await removerTelefoneLead(getDb(), contexto, leadId, telefoneId);
  if (!removeu) return telefoneNaoEncontrado();

  return new NextResponse(null, { status: 204 });
}

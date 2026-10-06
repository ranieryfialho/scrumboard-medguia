// T-074 (fase2c-whatsapp-conversa, US-047): GET/POST /api/leads/:id/telefones
// — telefones extras do lead (recepção, sócio, financeiro). Mesmo padrão de
// sessão das rotas de anexos (401 antes de qualquer tabela); `id` que nem é
// uuid nunca existe — mesmo 404 de lead alheio (AC-162/AC-164). Validação de
// `rotulo` (até 60 caracteres) fica aqui: o repositório (T-073) não a faz.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { getAuth } from '../../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../../lib/auth/tenant';
import {
  criarTelefoneLead,
  listarTelefonesLead,
  ErroLeadNaoEncontrado,
  ErroNumeroInvalido,
  ErroTelefoneDuplicado,
} from '../../../../../repositories/lead-telefones';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROTULO_MAX = 60;

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

function leadNaoEncontrado() {
  return NextResponse.json({ codigo: 'LEAD_NAO_ENCONTRADO' }, { status: 404 });
}

/** AC-163: principal (não removível) e extras do lead. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const { id: leadId } = await params;
  if (!UUID.test(leadId)) return leadNaoEncontrado();

  const telefones = await listarTelefonesLead(getDb(), contexto, leadId);
  if (!telefones) return leadNaoEncontrado();

  const lista = [
    ...(telefones.principal ? [{ numero: telefones.principal, principal: true as const }] : []),
    ...telefones.extras.map((extra) => ({
      id: extra.id,
      numero: extra.numero,
      rotulo: extra.rotulo,
      principal: false as const,
    })),
  ];
  return NextResponse.json({ telefones: lista });
}

/** AC-160/AC-161/AC-162: cadastra um telefone extra do lead. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const corpo = await request.json().catch(() => null);
  const numero = (corpo as { numero?: unknown } | null)?.numero;
  const rotulo = (corpo as { rotulo?: unknown } | null)?.rotulo;

  if (typeof numero !== 'string' || numero.trim() === '') {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }
  if (rotulo !== undefined && rotulo !== null && (typeof rotulo !== 'string' || rotulo.length > ROTULO_MAX)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const { id: leadId } = await params;
  if (!UUID.test(leadId)) return leadNaoEncontrado();

  try {
    const telefone = await criarTelefoneLead(getDb(), contexto, leadId, {
      numero,
      rotulo: typeof rotulo === 'string' ? rotulo : null,
    });
    return NextResponse.json(
      { id: telefone.id, numero: telefone.numero, rotulo: telefone.rotulo },
      { status: 201 }
    );
  } catch (erro) {
    if (erro instanceof ErroLeadNaoEncontrado) return leadNaoEncontrado();
    if (erro instanceof ErroNumeroInvalido) {
      return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
    }
    if (erro instanceof ErroTelefoneDuplicado) {
      return NextResponse.json({ codigo: 'TELEFONE_DUPLICADO' }, { status: 409 });
    }
    throw erro;
  }
}

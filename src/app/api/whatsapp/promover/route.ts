// T-232 (fase5-acoes-rapidas, AC-647 a AC-649): `POST /api/whatsapp/promover` — transforma um número
// avulso em lead com card em "Entrada de leads". 400 nome/número, 409 número já é de um lead, 401 sem sessão.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { promoverNumeroAvulso } from '../../../../repositories/whatsapp-promover';

export const dynamic = 'force-dynamic';

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

const STATUS: Record<string, number> = { NOME_OBRIGATORIO: 400, NUMERO_INVALIDO: 400, NUMERO_JA_E_LEAD: 409 };

export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const corpo = (await request.json().catch(() => null)) as { numero?: unknown; nome?: unknown } | null;
  const r = await promoverNumeroAvulso(getDb(), contexto, { numero: corpo?.numero, nome: corpo?.nome });
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: STATUS[r.codigo] });
  return NextResponse.json({ leadId: r.leadId, oportunidadeId: r.oportunidadeId, mensagensVinculadas: r.mensagensVinculadas }, { status: 201 });
}

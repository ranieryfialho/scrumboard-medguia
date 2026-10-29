// T-247 (fase5-whatsapp-lote-base, AC-671): `PATCH` edita (nome e/ou corpo), aprova (`acao: "aprovar"`) ou arquiva
// (`acao: "arquivar"`) um template — gerente, master ou super admin. Editar um aprovado o devolve a rascunho.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../../lib/auth/sessao';
import { alterarTemplate } from '../../../../../repositories/whatsapp-templates';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = { TEMPLATE_NAO_ENCONTRADO: 404, TEMPLATE_ARQUIVADO: 422, TEMPLATE_JA_EXISTE: 409, PARAMETRO_INVALIDO: 400 };

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'TEMPLATE_NAO_ENCONTRADO' }, { status: 404 });

  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; corpo?: unknown; acao?: unknown } | null;
  if (!corpo || (corpo.acao !== undefined && corpo.acao !== 'aprovar' && corpo.acao !== 'arquivar')) {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: 'acao', mensagem: 'A ação deve ser aprovar ou arquivar.' }, { status: 400 });
  }
  const r = await alterarTemplate(getDb(), contexto, id, { nome: corpo.nome, corpo: corpo.corpo, acao: corpo.acao as 'aprovar' | 'arquivar' | undefined });
  if (r.ok) return NextResponse.json(r.template);
  return NextResponse.json({ codigo: r.codigo, campo: r.campo, mensagem: r.mensagem }, { status: STATUS[r.codigo] ?? 422 });
}

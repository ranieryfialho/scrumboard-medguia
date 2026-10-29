// T-252 (fase5-whatsapp-lote-disparo, AC-677/AC-678/AC-683): `POST` cria um lote de WhatsApp com os elegíveis da prévia
// (recalculada aqui) e `GET` lista os lotes da empresa. Só gerente, master e super admin (ASM-247).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../lib/auth/sessao';
import { MAXIMO_DE_IDS_NA_PREVIA } from '../../../../lib/whatsapp/lote-regras';
import { criarLote, listarLotes } from '../../../../repositories/whatsapp-lote';
import { leadIdsDosCards } from '../../../../repositories/whatsapp-lote-previa';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = {
  TEMPLATE_NAO_ENCONTRADO: 404,
  TEMPLATE_NAO_APROVADO: 422,
  SEM_DESTINATARIOS: 422,
  WHATSAPP_NAO_CONFIGURADO: 409,
  LOTE_EM_ANDAMENTO: 409,
};
const recusa = (campo: string, mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo, mensagem }, { status: 400 });

export async function GET(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  return NextResponse.json({ lotes: await listarLotes(getDb(), contexto) });
}

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });

  const corpo = (await request.json().catch(() => null)) as { templateId?: unknown; leadIds?: unknown; oportunidadeIds?: unknown } | null;
  const campo = Array.isArray(corpo?.oportunidadeIds) ? 'oportunidadeIds' : 'leadIds';
  const ids = corpo?.[campo];
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === 'string' && UUID.test(i))) return recusa(campo, 'Informe a lista de leads ou de cards (ids válidos).');
  if (ids.length > MAXIMO_DE_IDS_NA_PREVIA) return recusa(campo, `Um lote aceita até ${MAXIMO_DE_IDS_NA_PREVIA} seleções por vez.`);
  if (typeof corpo?.templateId !== 'string' || !UUID.test(corpo.templateId)) return NextResponse.json({ codigo: 'TEMPLATE_NAO_ENCONTRADO' }, { status: 404 });

  const leadIds = campo === 'leadIds' ? (ids as string[]) : await leadIdsDosCards(getDb(), contexto, ids as string[]);
  const r = await criarLote(getDb(), contexto, { templateId: corpo.templateId, leadIds });
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: STATUS[r.codigo] });
  return NextResponse.json({ loteId: r.loteId, total: r.total, excluidos: r.excluidos, duracaoEstimadaSegundos: r.duracaoEstimadaSegundos }, { status: 201 });
}

// T-247 (fase5-whatsapp-lote-base, AC-675/AC-676): `POST /api/whatsapp/lote/previa` — quem receberia um lote com
// um template aprovado e quem fica de fora (e por quê). Não envia nada. Template em rascunho ou arquivado dá 422,
// o de outra empresa ou inexistente 404, ids demais ou inválidos 400, sem sessão 401.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { contextoDaSessao } from '../../../../../lib/auth/sessao';
import { MAXIMO_DE_IDS_NA_PREVIA } from '../../../../../lib/whatsapp/lote-regras';
import { previaDoLote } from '../../../../../repositories/whatsapp-lote-previa';
import { buscarTemplate } from '../../../../../repositories/whatsapp-templates';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recusa = (campo: string, mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo, mensagem }, { status: 400 });

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });

  const corpo = (await request.json().catch(() => null)) as { leadIds?: unknown; templateId?: unknown } | null;
  if (!Array.isArray(corpo?.leadIds) || corpo.leadIds.length === 0 || !corpo.leadIds.every((i) => typeof i === 'string' && UUID.test(i))) {
    return recusa('leadIds', 'Informe a lista de leads (ids válidos).');
  }
  if (corpo.leadIds.length > MAXIMO_DE_IDS_NA_PREVIA) return recusa('leadIds', `A prévia aceita até ${MAXIMO_DE_IDS_NA_PREVIA} leads por vez.`);
  if (typeof corpo.templateId !== 'string' || !UUID.test(corpo.templateId)) return NextResponse.json({ codigo: 'TEMPLATE_NAO_ENCONTRADO' }, { status: 404 });

  const template = await buscarTemplate(getDb(), contexto, corpo.templateId);
  if (!template) return NextResponse.json({ codigo: 'TEMPLATE_NAO_ENCONTRADO' }, { status: 404 });
  if (template.status !== 'aprovado') return NextResponse.json({ codigo: 'TEMPLATE_NAO_APROVADO' }, { status: 422 });

  const previa = await previaDoLote(getDb(), contexto, corpo.leadIds as string[], template.corpo);
  return NextResponse.json({ template: { id: template.id, nome: template.nome }, ...previa });
}

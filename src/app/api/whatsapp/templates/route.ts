// T-247 (fase5-whatsapp-lote-base, AC-670/AC-672): `GET` lista os templates da empresa (o gestor vê todos, os demais
// só os aprovados) e `POST` cria um template em rascunho (gerente, master ou super admin).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../lib/auth/sessao';
import { criarTemplate, listarTemplates } from '../../../../repositories/whatsapp-templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const templates = await listarTemplates(getDb(), contexto, { somenteAprovados: !ehGestor(contexto) });
  return NextResponse.json({ templates, podeGerir: ehGestor(contexto) });
}

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  if (!ehGestor(contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; corpo?: unknown } | null;
  const r = await criarTemplate(getDb(), contexto, { nome: corpo?.nome, corpo: corpo?.corpo });
  if (r.ok) return NextResponse.json(r.template, { status: 201 });
  return NextResponse.json({ codigo: r.codigo, campo: r.campo, mensagem: r.mensagem }, { status: r.codigo === 'TEMPLATE_JA_EXISTE' ? 409 : 400 });
}

// T-247 (fase5-whatsapp-lote-base, AC-670/AC-672): `GET` lista os templates da empresa (o gestor vê todos, os demais
// só os aprovados) e `POST` cria um template já aprovado e pronto para uso — qualquer usuário autenticado, inclusive o atendente.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { contextoDaSessao, ehGestor } from '../../../../lib/auth/sessao';
import { criarTemplate, listarTemplates } from '../../../../repositories/whatsapp-templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const templates = await listarTemplates(getDb(), contexto, { somenteAprovados: !ehGestor(contexto) });
  const gestor = ehGestor(contexto);
  // `podeEditar`: o gestor edita qualquer um; o atendente, só os que ele mesmo criou.
  const comPermissao = templates.map(({ criadoPorId, ...t }) => ({ ...t, podeEditar: gestor || criadoPorId === contexto.usuarioId }));
  return NextResponse.json({ templates: comPermissao, podeGerir: gestor });
}

export async function POST(request: NextRequest) {
  const contexto = await contextoDaSessao(request);
  if (!contexto) return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; corpo?: unknown } | null;
  const r = await criarTemplate(getDb(), contexto, { nome: corpo?.nome, corpo: corpo?.corpo });
  if (r.ok) return NextResponse.json(r.template, { status: 201 });
  return NextResponse.json({ codigo: r.codigo, campo: r.campo, mensagem: r.mensagem }, { status: r.codigo === 'TEMPLATE_JA_EXISTE' ? 409 : 400 });
}

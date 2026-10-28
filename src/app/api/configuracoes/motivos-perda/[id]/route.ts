// T-211 (fase4-admin, AC-596): `PATCH /api/configuracoes/motivos-perda/[id]` ativa ou desativa
// um motivo personalizado — só o super admin; motivo sistêmico não muda (422).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { exigirSuperAdmin } from '../../../../../lib/equipe/acesso';
import { alterarMotivo } from '../../../../../repositories/motivos-perda-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirSuperAdmin(request);
  if ('resposta' in acesso) return acesso.resposta;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ codigo: 'MOTIVO_NAO_ENCONTRADO' }, { status: 404 });
  const corpo = (await request.json().catch(() => null)) as { ativo?: unknown } | null;
  if (typeof corpo?.ativo !== 'boolean') return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });

  const r = await alterarMotivo(getDb(), id, corpo.ativo);
  if (r.ok) return NextResponse.json(r.motivo);
  return NextResponse.json({ codigo: r.codigo }, { status: r.codigo === 'MOTIVO_NAO_ENCONTRADO' ? 404 : 422 });
}

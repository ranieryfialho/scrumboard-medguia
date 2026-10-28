// T-209 (fase4-admin, AC-584): `POST /api/equipe/[usuarioId]/reenviar-convite` — token novo
// (o antigo deixa de valer) e e-mail de convite para quem ainda não definiu a senha.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { baseDaUrl, exigirGerente } from '../../../../../lib/equipe/acesso';
import { enviarConviteSemFalhar } from '../../../../../lib/equipe/enviar-convite';
import { reenviarConvite } from '../../../../../repositories/equipe';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_HTTP: Record<string, number> = { COLABORADOR_NAO_ENCONTRADO: 404, CONVITE_NAO_PENDENTE: 422, SEM_PERMISSAO: 403 };

export async function POST(request: NextRequest, { params }: { params: Promise<{ usuarioId: string }> }) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const { usuarioId } = await params;
  if (!UUID.test(usuarioId)) return NextResponse.json({ codigo: 'COLABORADOR_NAO_ENCONTRADO' }, { status: 404 });

  const r = await reenviarConvite(getDb(), acesso.contexto, usuarioId);
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: STATUS_HTTP[r.codigo] ?? 422 });

  const envio = await enviarConviteSemFalhar(r.email, r.token, baseDaUrl(request));
  return NextResponse.json({ usuarioId, expiraEm: r.expiraEm, ...envio });
}

// T-209 (fase4-admin, AC-582/AC-583): `PATCH /api/equipe/[usuarioId]` — troca o papel e
// ativa ou desativa a pessoa nesta empresa. Só MASTER e super admin (ASM-202); ninguém
// altera a si mesmo e a empresa sempre mantém um MASTER ativo (ASM-203).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { ehMasterOuSuper, exigirGerente } from '../../../../lib/equipe/acesso';
import { PAPEIS, alterarColaborador } from '../../../../repositories/equipe';
import type { PapelUsuario } from '../../../../lib/auth/convites';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_HTTP: Record<string, number> = { COLABORADOR_NAO_ENCONTRADO: 404, NAO_PODE_ALTERAR_A_SI: 422, ULTIMO_MASTER: 422, SEM_ASSENTOS: 409 };

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ usuarioId: string }> }) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  if (!ehMasterOuSuper(acesso.contexto)) return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });

  const { usuarioId } = await params;
  if (!UUID.test(usuarioId)) return NextResponse.json({ codigo: 'COLABORADOR_NAO_ENCONTRADO' }, { status: 404 });

  const corpo = (await request.json().catch(() => null)) as { papel?: unknown; ativo?: unknown } | null;
  const papel = corpo?.papel;
  const ativo = corpo?.ativo;
  const papelOk = papel === undefined || (typeof papel === 'string' && PAPEIS.includes(papel as PapelUsuario));
  const ativoOk = ativo === undefined || typeof ativo === 'boolean';
  if (!corpo || !papelOk || !ativoOk || (papel === undefined && ativo === undefined)) {
    return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  }

  const r = await alterarColaborador(getDb(), acesso.contexto, usuarioId, { papel: papel as PapelUsuario | undefined, ativo: ativo as boolean | undefined });
  if (r.ok) return NextResponse.json(r.colaborador);
  return NextResponse.json({ codigo: r.codigo }, { status: STATUS_HTTP[r.codigo] ?? 422 });
}

// T-209 (fase4-admin, AC-578): `GET /api/equipe` — a equipe da empresa da sessão, com
// filtro, busca e paginação. 401/403/400 antes do banco; só gerente, master e super admin.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { exigirGerente } from '../../../lib/equipe/acesso';
import { PAPEIS, listarEquipe, type SituacaoDoColaborador } from '../../../repositories/equipe';
import type { PapelUsuario } from '../../../lib/auth/convites';

export const dynamic = 'force-dynamic';

const STATUS: readonly SituacaoDoColaborador[] = ['ativo', 'pendente', 'inativo'];

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const p = request.nextUrl.searchParams;
  const invalido = (mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem }, { status: 400 });
  const papel = p.get('papel');
  if (papel && !PAPEIS.includes(papel as PapelUsuario)) return invalido('O filtro de papel é inválido.');
  const status = p.get('status');
  if (status && !STATUS.includes(status as SituacaoDoColaborador)) return invalido('O filtro de situação é inválido.');
  const pagina = p.get('pagina') ? Number(p.get('pagina')) : undefined;
  const porPagina = p.get('porPagina') ? Number(p.get('porPagina')) : undefined;
  if ((pagina !== undefined && (!Number.isInteger(pagina) || pagina < 1)) || (porPagina !== undefined && (!Number.isInteger(porPagina) || porPagina < 1 || porPagina > 100))) {
    return invalido('A paginação é inválida.');
  }

  const lista = await listarEquipe(getDb(), acesso.contexto, {
    papel: (papel as PapelUsuario | null) ?? undefined,
    status: (status as SituacaoDoColaborador | null) ?? undefined,
    busca: p.get('busca') ?? undefined,
    pagina,
    porPagina,
  });
  return NextResponse.json(lista);
}

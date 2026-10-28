// T-212 (fase4-admin, AC-608/AC-609): `GET` traz o detalhe de uma empresa e `PATCH` muda o
// nome e/ou a situação (suspender e reativar). Só o super admin; o identificador não muda.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { exigirSuperAdmin } from '../../../../../lib/equipe/acesso';
import { detalharEmpresa, editarEmpresa } from '../../../../../repositories/empresas-admin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const naoEncontrada = () => NextResponse.json({ codigo: 'EMPRESA_NAO_ENCONTRADA' }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirSuperAdmin(request);
  if ('resposta' in acesso) return acesso.resposta;
  const { id } = await params;
  if (!UUID.test(id)) return naoEncontrada();
  const detalhe = await detalharEmpresa(getDb(), id);
  return detalhe ? NextResponse.json(detalhe) : naoEncontrada();
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await exigirSuperAdmin(request);
  if ('resposta' in acesso) return acesso.resposta;
  const { id } = await params;
  if (!UUID.test(id)) return naoEncontrada();

  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; ativo?: unknown } | null;
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : undefined;
  const ativo = corpo?.ativo;
  if (
    !corpo ||
    (nome === undefined && ativo === undefined) ||
    (nome !== undefined && (nome.length < 3 || nome.length > 80)) ||
    (ativo !== undefined && typeof ativo !== 'boolean')
  ) {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem: 'Informe um nome de 3 a 80 caracteres ou a situação.' }, { status: 400 });
  }

  const r = await editarEmpresa(getDb(), acesso.contexto, id, { nome, ativo: ativo as boolean | undefined });
  if (r.ok) return NextResponse.json(r.empresa);
  return r.codigo === 'EMPRESA_NAO_ENCONTRADA' ? naoEncontrada() : NextResponse.json({ codigo: r.codigo }, { status: 422 });
}

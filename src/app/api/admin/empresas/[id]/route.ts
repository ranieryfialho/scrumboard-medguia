// T-212 (fase4-admin, AC-608/AC-609): `GET` traz o detalhe de uma empresa e `PATCH` muda o
// nome e/ou a situação (suspender e reativar). Só o super admin; o identificador não muda.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../../db/client';
import { exigirSuperAdmin } from '../../../../../lib/equipe/acesso';
import { validarDadosDaEmpresa } from '../../../../../lib/empresa/validacao';
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

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : undefined;
  const ativo = corpo?.ativo;
  const recusa = (campo: string | undefined, mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo, mensagem }, { status: 400 });
  if (!corpo) return recusa(undefined, 'Informe o que mudar.');
  if (nome !== undefined && (nome.length < 3 || nome.length > 80)) return recusa('nome', 'O nome deve ter de 3 a 80 caracteres.');
  if (ativo !== undefined && typeof ativo !== 'boolean') return recusa('ativo', 'A situação é inválida.');
  const validacao = validarDadosDaEmpresa(corpo, { completo: false });
  if (!validacao.ok) return recusa(validacao.campo, validacao.mensagem);
  if (nome === undefined && ativo === undefined && Object.keys(validacao.dados).length === 0) return recusa(undefined, 'Informe o que mudar.');

  const r = await editarEmpresa(getDb(), acesso.contexto, id, { nome, ativo: ativo as boolean | undefined, dados: validacao.dados });
  if (r.ok) return NextResponse.json(r.empresa);
  if (r.codigo === 'EMPRESA_NAO_ENCONTRADA') return naoEncontrada();
  return NextResponse.json({ codigo: r.codigo }, { status: r.codigo === 'CNPJ_EM_USO' || r.codigo === 'ASSENTOS_ABAIXO_DO_EM_USO' ? 409 : 422 });
}

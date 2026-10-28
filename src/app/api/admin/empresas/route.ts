// T-212 (fase4-admin, AC-599/AC-604/AC-605): `GET` lista as empresas da rede e `POST` cria uma
// empresa já convidando o master. Só o super admin (401/403 antes do banco).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { baseDaUrl, exigirSuperAdmin } from '../../../../lib/equipe/acesso';
import { enviarConviteSemFalhar } from '../../../../lib/equipe/enviar-convite';
import { SLUG_VALIDO, criarEmpresa, listarEmpresas } from '../../../../repositories/empresas-admin';
import { emailValido } from '../../../../repositories/equipe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirSuperAdmin(request);
  if ('resposta' in acesso) return acesso.resposta;

  const status = request.nextUrl.searchParams.get('status');
  if (status && status !== 'ativa' && status !== 'inativa') {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem: 'O filtro de situação é inválido.' }, { status: 400 });
  }
  return NextResponse.json(await listarEmpresas(getDb(), { status: (status as 'ativa' | 'inativa' | null) ?? undefined, busca: request.nextUrl.searchParams.get('busca') ?? undefined }));
}

export async function POST(request: NextRequest) {
  const acesso = await exigirSuperAdmin(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const nome = texto(corpo?.nome);
  const slug = texto(corpo?.slug);
  const masterNome = texto(corpo?.masterNome);
  const masterEmail = texto(corpo?.masterEmail);
  const recusa = (campo: string, mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo, mensagem }, { status: 400 });

  if (nome.length < 3 || nome.length > 80) return recusa('nome', 'O nome deve ter de 3 a 80 caracteres.');
  if (!SLUG_VALIDO.test(slug)) return recusa('slug', 'O identificador deve ter de 3 a 40 letras minúsculas, números e hífens, sem hífen no começo ou no fim.');
  if (masterNome.length === 0 || masterNome.length > 120) return recusa('masterNome', 'Informe o nome do administrador master.');
  if (!emailValido(masterEmail)) return recusa('masterEmail', 'Informe um e-mail válido para o administrador master.');

  const r = await criarEmpresa(getDb(), acesso.contexto, { nome, slug, masterNome, masterEmail });
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: 409 });

  const envio = await enviarConviteSemFalhar(r.masterEmail, r.token, baseDaUrl(request));
  return NextResponse.json({ id: r.id, slug: r.slug, masterUsuarioId: r.masterUsuarioId, ...envio }, { status: 201 });
}

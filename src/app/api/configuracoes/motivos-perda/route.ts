// T-211 (fase4-admin, AC-593/AC-596): `GET` lista os motivos de perda que a empresa enxerga (globais e
// da empresa, inclusive os inativos) com o uso na empresa da sessão; `POST` cria um motivo da empresa —
// gerente, master e super admin (fase5-motivos-por-empresa, AC-660).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { criarMotivo, listarMotivos } from '../../../../repositories/motivos-perda-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const p = request.nextUrl.searchParams;
  const tipo = p.get('tipo');
  const status = p.get('status');
  if ((tipo && tipo !== 'sistemico' && tipo !== 'personalizado') || (status && status !== 'ativo' && status !== 'inativo')) {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', mensagem: 'Filtro inválido.' }, { status: 400 });
  }
  return NextResponse.json(
    await listarMotivos(getDb(), acesso.contexto, {
      tipo: (tipo as 'sistemico' | 'personalizado' | null) ?? undefined,
      status: (status as 'ativo' | 'inativo' | null) ?? undefined,
      busca: p.get('busca') ?? undefined,
      agora: new Date(),
    })
  );
}

export async function POST(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as { nome?: unknown } | null;
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';
  if (nome.length < 3 || nome.length > 80) {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: 'nome', mensagem: 'O nome deve ter de 3 a 80 caracteres.' }, { status: 400 });
  }
  const r = await criarMotivo(getDb(), acesso.contexto, nome);
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: 409 });
  return NextResponse.json(r.motivo, { status: 201 });
}

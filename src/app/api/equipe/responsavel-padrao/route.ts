// Responsável padrão dos cards novos da empresa (migration 0036). Só gerente, master e super admin (como o resto de /api/equipe).
//   GET   -> { responsavelId, responsaveis, semResponsavel }
//   PUT   -> { responsavelId: string | null }  escolhe (ou limpa) o responsável padrão
//   POST  -> { aplicar: true }                 leva o padrão aos cards que estão sem responsável
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { aplicarResponsavelPadrao, definirResponsavelPadrao, lerResponsavelPadrao } from '../../../../repositories/responsavel-padrao';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  return NextResponse.json(await lerResponsavelPadrao(getDb(), acesso.contexto));
}

export async function PUT(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const corpo = (await request.json().catch(() => null)) as { responsavelId?: unknown } | null;
  const id = corpo?.responsavelId;
  if (!(id === null || (typeof id === 'string' && UUID.test(id)))) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  const r = await definirResponsavelPadrao(getDb(), acesso.contexto, id);
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: 422 });
  return NextResponse.json(await lerResponsavelPadrao(getDb(), acesso.contexto));
}

export async function POST(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const corpo = (await request.json().catch(() => null)) as { aplicar?: unknown } | null;
  if (corpo?.aplicar !== true) return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
  const r = await aplicarResponsavelPadrao(getDb(), acesso.contexto);
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: 409 });
  return NextResponse.json({ aplicados: r.aplicados, falhas: r.falhas, ...(await lerResponsavelPadrao(getDb(), acesso.contexto)) });
}

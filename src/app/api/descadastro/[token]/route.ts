// T-272 (fase5-email-descadastro, AC-715/AC-716): rota PÚBLICA do descadastro. `GET` só diz para quem é o link (nome da
// empresa e e-mail mascarado) e NÃO altera nada; `POST` descadastra — é o que a página chama ao confirmar e o que o Gmail e
// outros chamam pelo `List-Unsubscribe-Post` (um clique, corpo `List-Unsubscribe=One-Click`). Token inválido: 404 no GET
// e 400 no POST, sem revelar nada da empresa nem do e-mail.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { verificarTokenDeDescadastro, mascararEmail } from '../../../../lib/email/descadastro-token';
import { segredoDeConfiguracoes } from '../../../../lib/seguranca/cifra';
import { descadastrar, nomeDaEmpresa } from '../../../../repositories/email-descadastros';

export const dynamic = 'force-dynamic';

async function resolver(token: string) {
  const segredo = segredoDeConfiguracoes();
  const dados = segredo ? verificarTokenDeDescadastro(token, segredo) : null;
  if (!dados) return null;
  const empresaNome = await nomeDaEmpresa(getDb(), dados.empresaId);
  return empresaNome ? { ...dados, empresaNome } : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const dados = await resolver((await params).token);
  if (!dados) return NextResponse.json({ codigo: 'LINK_INVALIDO' }, { status: 404 });
  return NextResponse.json({ empresaNome: dados.empresaNome, emailMascarado: mascararEmail(dados.email) });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const dados = await resolver((await params).token);
  if (!dados) return NextResponse.json({ codigo: 'LINK_INVALIDO' }, { status: 400 });
  await descadastrar(getDb(), dados.empresaId, dados.email);
  return NextResponse.json({ ok: true, empresaNome: dados.empresaNome });
}

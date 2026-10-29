// T-260 (fase5-email-config, AC-695/AC-696): `GET` devolve a configuração de e-mail da empresa SEM a chave (só se há chave e
// os 4 últimos caracteres) e `PUT` grava chave (cifrada) e remetente. Gerente, master e super admin (ASM-258).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { ErroConfiguracaoIndisponivel } from '../../../../lib/seguranca/cifra';
import { gravarConfiguracaoDeEmail, lerConfiguracaoDeEmailPublica } from '../../../../repositories/email-config';

export const dynamic = 'force-dynamic';

const CHAVE_RESEND = /^re_\S{17,197}$/;
const REMETENTE = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]{1,80}<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>)$/;
const recusa = (campo: string, mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo, mensagem }, { status: 400 });

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  return NextResponse.json(await lerConfiguracaoDeEmailPublica(getDb(), acesso.contexto));
}

export async function PUT(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as { chave?: unknown; remetente?: unknown } | null;
  if (!corpo || typeof corpo !== 'object') return recusa('chave', 'Informe a configuração.');

  const alteracao: { chave?: string | null; remetente?: string | null } = {};
  if (corpo.chave !== undefined) {
    if (corpo.chave === null) alteracao.chave = null;
    else if (typeof corpo.chave === 'string' && CHAVE_RESEND.test(corpo.chave.trim()) && corpo.chave.trim().length <= 200) alteracao.chave = corpo.chave.trim();
    else return recusa('chave', 'A chave do Resend começa com re_, tem de 20 a 200 caracteres e não tem espaços.');
  }
  if (corpo.remetente !== undefined) {
    if (corpo.remetente === null || corpo.remetente === '') alteracao.remetente = null;
    else if (typeof corpo.remetente === 'string' && corpo.remetente.trim().length <= 200 && REMETENTE.test(corpo.remetente.trim())) alteracao.remetente = corpo.remetente.trim();
    else return recusa('remetente', 'Informe o remetente como email@dominio.com ou Nome <email@dominio.com>.');
  }
  if (Object.keys(alteracao).length === 0) return recusa('chave', 'Informe a chave ou o remetente.');

  try {
    await gravarConfiguracaoDeEmail(getDb(), acesso.contexto, alteracao);
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoIndisponivel) {
      return NextResponse.json({ codigo: 'CONFIGURACAO_INDISPONIVEL', mensagem: 'O servidor não está pronto para guardar a chave com segurança. Avise o suporte.' }, { status: 503 });
    }
    throw erro;
  }
  return NextResponse.json(await lerConfiguracaoDeEmailPublica(getDb(), acesso.contexto));
}

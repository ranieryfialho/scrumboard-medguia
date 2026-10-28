// T-210 (fase4-admin, AC-587/AC-588): `POST /api/equipe/convites` — convida uma pessoa para a
// empresa da sessão (token de uso único de 24 h + e-mail MedCRM) e devolve o link. GERENTE só
// convida ATENDENTE (ASM-202). A empresa vem só da sessão, nunca do corpo.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { baseDaUrl, exigirGerente } from '../../../../lib/equipe/acesso';
import { enviarConviteSemFalhar } from '../../../../lib/equipe/enviar-convite';
import { PAPEIS, convidarParaEquipe, emailValido } from '../../../../repositories/equipe';
import type { PapelUsuario } from '../../../../lib/auth/convites';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as { email?: unknown; nome?: unknown; papel?: unknown } | null;
  const email = typeof corpo?.email === 'string' ? corpo.email.trim() : '';
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';
  const papel = corpo?.papel;
  if (!emailValido(email)) return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: 'email', mensagem: 'Informe um e-mail válido.' }, { status: 400 });
  if (nome.length === 0 || nome.length > 120) return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: 'nome', mensagem: 'Informe o nome (até 120 caracteres).' }, { status: 400 });
  if (typeof papel !== 'string' || !PAPEIS.includes(papel as PapelUsuario)) {
    return NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo: 'papel', mensagem: 'Papel inválido.' }, { status: 400 });
  }

  const r = await convidarParaEquipe(getDb(), acesso.contexto, { email, nome, papel: papel as PapelUsuario });
  if (!r.ok) return NextResponse.json({ codigo: r.codigo }, { status: r.codigo === 'JA_E_COLABORADOR' ? 409 : 403 });

  const envio = r.token ? await enviarConviteSemFalhar(r.email, r.token, baseDaUrl(request), undefined) : { emailEnviado: false, linkConvite: null };
  return NextResponse.json(
    { usuarioId: r.usuarioId, papel: r.papel, expiraEm: r.expiraEm, reativado: r.reativado, ...envio },
    { status: 201 }
  );
}

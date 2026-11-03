// T-301 (fase4-tarefas-agenda, AC-765/AC-766): `GET` diz se o servidor tem as credenciais do Google e se há conta conectada; `DELETE` desconecta
// (tira a permissão no Google, em melhor esforço, e apaga o token). Gerente, master e super admin. O token nunca sai do servidor.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { configDoGoogle, revogar } from '../../../../lib/google/calendario';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { lerGoogleConectado, lerRefreshToken, removerGoogleConectado } from '../../../../repositories/google-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const conexao = await lerGoogleConectado(getDb(), acesso.contexto.empresaId);
  return NextResponse.json({ configuradoNoServidor: configDoGoogle() !== null, ...conexao });
}

export async function DELETE(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const empresaId = acesso.contexto.empresaId;
  const refresh = await lerRefreshToken(getDb(), empresaId);
  if (refresh) await revogar(refresh);
  await removerGoogleConectado(getDb(), empresaId);
  return NextResponse.json({ conectado: false, conta: null });
}

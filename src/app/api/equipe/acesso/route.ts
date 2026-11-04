// T-321 (fase4-admin, US-137): `GET /api/equipe/acesso` — o que a tela "Sessão e acesso" mostra: a duração da sessão e o IP de onde
// a pessoa está acessando agora. Só gerente, master e super admin.
import { NextResponse, type NextRequest } from 'next/server';

import { DURACAO_DA_SESSAO_DIAS } from '../../../../lib/auth/sessao-config';
import { exigirGerente } from '../../../../lib/equipe/acesso';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  return NextResponse.json({ sessaoDias: DURACAO_DA_SESSAO_DIAS, ip });
}

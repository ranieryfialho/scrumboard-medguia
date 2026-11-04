// T-309 (fase4-campanhas, US-130): `GET /api/campanhas/entregabilidade` — o domínio do remetente da empresa e se ele tem SPF, DKIM
// e DMARC no DNS. Gerente, master e super admin.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { dominioDoRemetente, verificarEntregabilidade } from '../../../../lib/email/entregabilidade';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { lerConfiguracaoDeEmailPublica } from '../../../../repositories/email-config';

export const dynamic = 'force-dynamic';

const REMETENTE_PADRAO = 'no-reply@medguia.cloud';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const config = await lerConfiguracaoDeEmailPublica(getDb(), acesso.contexto);
  const remetente = config.remetente ?? process.env.RESEND_REMETENTE ?? REMETENTE_PADRAO;
  return NextResponse.json({ remetenteConfigurado: config.remetente !== null, ...(await verificarEntregabilidade(dominioDoRemetente(remetente))) });
}

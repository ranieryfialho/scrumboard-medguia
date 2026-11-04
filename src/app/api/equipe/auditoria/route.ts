// T-321 (fase4-admin, US-137): `GET /api/equipe/auditoria` — o registro de auditoria da empresa (equipe e exportações), do mais novo
// para o mais antigo. Só gerente, master e super admin.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirGerente } from '../../../../lib/equipe/acesso';
import { listarAuditoria } from '../../../../repositories/auditoria-equipe';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  return NextResponse.json({ eventos: await listarAuditoria(getDb(), acesso.contexto) });
}

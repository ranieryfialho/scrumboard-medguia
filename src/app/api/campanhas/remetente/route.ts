// `GET /api/campanhas/remetente`: o remetente e o e-mail de resposta que a empresa configurou, para a tela de nova campanha. Só leitura e
// sem a chave do Resend (nem o final dela); quem pode mexer na configuração continua sendo o gerente, em /configuracoes/email. Libera quem
// tem o módulo Campanhas, inclusive um atendente.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { exigirAcessoACampanhas } from '../../../../lib/campanhas/acesso';
import { lerConfiguracaoDeEmailPublica } from '../../../../repositories/email-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const acesso = await exigirAcessoACampanhas(request);
  if ('resposta' in acesso) return acesso.resposta;
  const config = await lerConfiguracaoDeEmailPublica(getDb(), acesso.contexto);
  return NextResponse.json({ chaveConfigurada: config.chaveConfigurada, remetente: config.remetente, ...(config.responderPara ? { responderPara: config.responderPara } : {}) });
}

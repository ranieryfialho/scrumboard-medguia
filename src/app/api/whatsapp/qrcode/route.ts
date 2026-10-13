// T-087 (fase2c-whatsapp-conexao, US-050/US-051): rota GET
// /api/whatsapp/qrcode — substitui a legada em Supabase (service role, sem
// tenant e sem papel) e encerra o último uso de Supabase nas rotas de
// WhatsApp (`src/lib/evolution-server.ts` apagado). `?action=status` tem o
// mesmo comportamento da rota de status (T-086): qualquer papel consulta,
// sem instância cadastrada responde `not_configured` sem chamar a Evolution
// (AC-175/AC-176). Sem o parâmetro, o fluxo completo exige MASTER, GERENTE
// ou super admin (403, ASM-048, AC-178) → instância cadastrada (409
// `WHATSAPP_NAO_CONFIGURADO`, AC-179) → cria a instância na Evolution (502
// `FALHA_EVOLUTION` se falhar com algo além de "já existe", AC-186, sem
// gerar segredo novo nem registrar webhook) → só então obtém/gera o segredo
// do webhook (ASM-049, AC-182) e registra o webhook com `empresa_id` e
// `secret` na URL (ASM-053, AC-181) → pede a conexão (QR code). Falha ao
// registrar o webhook não esconde o QR, só avisa (`webhookRegistrado:
// false`, AC-185). Instância já conectada devolve `{ state: 'open' }` sem
// QR (AC-184). Resposta mantém os nomes do legado (`base64`, `state`) e só
// acrescenta `webhookRegistrado` (fora de escopo da spec: telas não mudam).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buildConfig, createInstance, getInstanceStatus, getQRCode, setWebhook } from '../../../../lib/evolution-api';
import { obterOuCriarSegredoWebhook } from '../../../../repositories/whatsapp-config';
import { buscarNomeInstancia } from '../../../../repositories/whatsapp-instancia';

export const dynamic = 'force-dynamic';

async function resolverContexto(request: NextRequest): Promise<ContextoTenant | null> {
  const sessao = await getAuth().api.getSession({ headers: request.headers });
  if (!sessao) return null;

  try {
    return await resolverContextoTenant(getDb(), { token: sessao.session.token });
  } catch (erro) {
    if (erro instanceof ErroSessaoInvalida) return null;
    throw erro;
  }
}

function semSessao() {
  return NextResponse.json({ codigo: 'NAO_AUTENTICADO' }, { status: 401 });
}

function semPermissao() {
  return NextResponse.json({ codigo: 'SEM_PERMISSAO' }, { status: 403 });
}

function whatsappNaoConfigurado() {
  return NextResponse.json({ codigo: 'WHATSAPP_NAO_CONFIGURADO' }, { status: 409 });
}

function falhaEvolution() {
  return NextResponse.json({ codigo: 'FALHA_EVOLUTION' }, { status: 502 });
}

/** MASTER, GERENTE e super admin conectam o WhatsApp (ASM-048). */
function podeConectar(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const db = getDb();
  const somenteStatus = request.nextUrl.searchParams.get('action') === 'status';

  if (somenteStatus) {
    const nomeInstancia = await buscarNomeInstancia(db, contexto);
    if (!nomeInstancia) return NextResponse.json({ state: 'not_configured', instance: null });

    const config = buildConfig(nomeInstancia);
    const status = await getInstanceStatus(config);
    const state = status?.instance?.state || status?.state || 'close';
    return NextResponse.json({ state, instance: nomeInstancia });
  }

  if (!podeConectar(contexto)) return semPermissao();

  const nomeInstancia = await buscarNomeInstancia(db, contexto);
  if (!nomeInstancia) return whatsappNaoConfigurado();

  const config = buildConfig(nomeInstancia);

  try {
    await createInstance(config);
  } catch {
    return falhaEvolution();
  }

  const segredo = await obterOuCriarSegredoWebhook(db, contexto);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`;
  const webhookUrl = `${appUrl}/api/whatsapp/webhook?empresa_id=${contexto.empresaId}&secret=${segredo}`;
  const webhookRegistrado = await setWebhook(config, webhookUrl);

  const resultado = await getQRCode(config);
  if (resultado.state === 'open') {
    return NextResponse.json({ state: 'open' });
  }
  if (resultado.error || !resultado.base64) {
    return falhaEvolution();
  }

  return NextResponse.json({ base64: resultado.base64, webhookRegistrado });
}

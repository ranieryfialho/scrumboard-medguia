// T-085 (fase2c-whatsapp-conexao, US-048/US-049): rota GET e POST
// /api/whatsapp/config — substitui a legada em Supabase (service role, sem
// tenant e sem papel). Ordem: sessão (401) → papel no POST (403, ASM-048) →
// corpo (400, T-083) → repositório (409 se o nome já está em uso, T-084).
// Resposta mantém os nomes do legado (`{ empresaId, config }`,
// `{ success: true }`) — as telas não mudam (fora de escopo da spec).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { validarCorpoConfig } from '../../../../domain/whatsapp/config';
import { getAuth } from '../../../../lib/auth/instancia';
import { EVENTOS_DO_WEBHOOK, urlDoWebhookMascarada } from '../../../../lib/whatsapp/webhook-url';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { ErroInstanciaEmUso, lerConfiguracao, salvarConfiguracao } from '../../../../repositories/whatsapp-config';

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

function requisicaoInvalida() {
  return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
}

function instanciaEmUso() {
  return NextResponse.json({ codigo: 'INSTANCIA_EM_USO' }, { status: 409 });
}

/** MASTER, GERENTE e super admin alteram a configuração (ASM-048). */
function podeAlterarConfiguracao(contexto: ContextoTenant): boolean {
  return contexto.isSuperAdmin || contexto.papel === 'MASTER' || contexto.papel === 'GERENTE';
}

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const config = await lerConfiguracao(getDb(), contexto);
  // T-193 (AC-524): além de `{ empresaId, config }`, o que a tela de configuração mostra —
  // a URL do servidor e se a chave existe (nunca a chave), a URL do webhook com o
  // segredo mascarado e os eventos que o CRM registra.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${request.headers.get('host')}`;
  return NextResponse.json({
    empresaId: contexto.empresaId,
    config,
    servidor: { urlBase: process.env.EVOLUTION_API_URL ?? null, chaveConfigurada: Boolean(process.env.EVOLUTION_API_KEY) },
    webhookUrl: urlDoWebhookMascarada(appUrl, contexto.empresaId),
    eventos: [...EVENTOS_DO_WEBHOOK],
  });
}

export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();
  if (!podeAlterarConfiguracao(contexto)) return semPermissao();

  const corpoBruto = await request.json().catch(() => null);
  const resultado = validarCorpoConfig(corpoBruto);
  if (!resultado.ok) return requisicaoInvalida();

  try {
    await salvarConfiguracao(getDb(), contexto, resultado.valores);
  } catch (erro) {
    if (erro instanceof ErroInstanciaEmUso) return instanciaEmUso();
    throw erro;
  }

  return NextResponse.json({ success: true });
}

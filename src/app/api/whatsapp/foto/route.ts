// GET /api/whatsapp/foto?numero= | ?leadId= — a foto de perfil do contato no WhatsApp, servida pelo próprio CRM (a URL da Evolution expira e não deve
// ir para o navegador). `leadId` acha o telefone do lead no servidor (principal, ou o primeiro extra), só dentro da empresa da sessão.
// Sessão (401) → número/lead válido (400) → instância (404) → foto em cache ou buscada na Evolution; sem foto = 404, e a tela
// mostra as iniciais.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { normalizarNumero, variantesNumero } from '../../../../domain/whatsapp/numero';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buildConfig, fetchProfilePictureUrl } from '../../../../lib/evolution-api';
import { listarTelefonesLead } from '../../../../repositories/lead-telefones';
import { obterFotoDoContato } from '../../../../lib/whatsapp/foto-contato';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const erro = (codigo: string, status: number, cache = 'no-store') =>
  NextResponse.json({ codigo }, { status, headers: { 'Cache-Control': cache } });

export async function GET(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return erro('NAO_AUTENTICADO', 401);

  const leadId = request.nextUrl.searchParams.get('leadId');
  let numero: string | null;
  if (leadId) {
    if (!UUID.test(leadId)) return erro('REQUISICAO_INVALIDA', 400);
    const telefones = await listarTelefonesLead(getDb(), contexto, leadId);
    // Lead de outra empresa ou inexistente dá o mesmo "sem foto" (não revela que existe).
    const telefone = telefones?.principal ?? (telefones?.extras[0] ? normalizarNumero(telefones.extras[0].numero) : null);
    if (!telefone) return erro('SEM_FOTO', 404, 'private, max-age=300');
    numero = telefone;
  } else {
    numero = normalizarNumero(request.nextUrl.searchParams.get('numero') ?? '');
  }
  if (!numero) return erro('REQUISICAO_INVALIDA', 400);

  const nomeInstancia = await buscarNomeInstancia(getDb(), contexto);
  if (!nomeInstancia) return erro('WHATSAPP_NAO_CONFIGURADO', 404);
  const config = buildConfig(nomeInstancia);

  const bytes = await obterFotoDoContato({
    empresaId: contexto.empresaId,
    numero,
    // O número pode estar gravado com ou sem o nono dígito: tenta as duas grafias até achar a foto.
    buscarUrl: async () => {
      for (const variante of [numero, ...variantesNumero(numero).filter((v) => v !== numero)]) {
        const url = await fetchProfilePictureUrl(config, variante);
        if (url) return url;
      }
      return null;
    },
  });

  // Sem foto é um resultado normal (privacidade do contato): o navegador lembra por pouco tempo e a tela cai nas iniciais.
  if (!bytes) return erro('SEM_FOTO', 404, 'private, max-age=300');

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' },
  });
}

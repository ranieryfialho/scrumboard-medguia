// T-078 (fase2c-whatsapp-conversa, US-043/US-044): rota POST
// /api/whatsapp/send — substitui a legada em Supabase (service role, sem
// tenant). Ordem: sessão (401) → corpo (400) → destino (lead 404 / telefone
// 404 / sem telefone 422, ou número avulso) → instância (409) → Evolution
// fora da transação do banco (502/422, ASM-041) → grava `enviada` ligada ao
// lead (AC-142 já resolvido por `registrarMensagemEnviada`, T-075/T-076).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { normalizarNumero } from '../../../../domain/whatsapp/numero';
import { getAuth } from '../../../../lib/auth/instancia';
import { ErroSessaoInvalida, resolverContextoTenant, type ContextoTenant } from '../../../../lib/auth/tenant';
import { buildConfig, sendTextMessage } from '../../../../lib/evolution-api';
import { listarTelefonesLead } from '../../../../repositories/lead-telefones';
import { registrarMensagemEnviada } from '../../../../repositories/whatsapp';
import { buscarNomeInstancia } from '../../../../repositories/whatsapp-instancia';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENSAGEM_MAX = 4096;

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

function requisicaoInvalida() {
  return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
}

function leadNaoEncontrado() {
  return NextResponse.json({ codigo: 'LEAD_NAO_ENCONTRADO' }, { status: 404 });
}

function telefoneNaoEncontrado() {
  return NextResponse.json({ codigo: 'TELEFONE_NAO_ENCONTRADO' }, { status: 404 });
}

function leadSemTelefone() {
  return NextResponse.json({ codigo: 'LEAD_SEM_TELEFONE' }, { status: 422 });
}

function whatsappNaoConfigurado() {
  return NextResponse.json({ codigo: 'WHATSAPP_NAO_CONFIGURADO' }, { status: 409 });
}

function falhaEnvio() {
  return NextResponse.json({ codigo: 'FALHA_ENVIO' }, { status: 502 });
}

function numeroSemWhatsapp() {
  return NextResponse.json({ codigo: 'NUMERO_SEM_WHATSAPP' }, { status: 422 });
}

interface CorpoValidado {
  mensagem: string;
  leadId?: string;
  telefoneId?: string;
  /** Só presente no envio para número avulso — já normalizado (ASM-046). */
  numero?: string;
}

/**
 * Valida o corpo do pedido de envio (AC-143): `mensagem` não vazia (nem só
 * espaços) e até 4096 caracteres; exatamente um entre `leadId` e `numero`
 * (nunca os dois, nunca nenhum); `numero`, quando presente, normalizado a
 * dígitos válidos entre 10 e 15 (ASM-046). `null` recusa o pedido.
 */
function validarCorpo(corpo: unknown): CorpoValidado | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const { mensagem, leadId, numero, telefoneId } = corpo as Record<string, unknown>;

  if (typeof mensagem !== 'string' || mensagem.trim() === '' || mensagem.length > MENSAGEM_MAX) {
    return null;
  }

  const temLeadId = typeof leadId === 'string' && leadId.trim() !== '';
  const temNumero = typeof numero === 'string' && numero.trim() !== '';
  if (temLeadId === temNumero) return null; // precisa de exatamente um dos dois

  if (temNumero) {
    const normalizado = normalizarNumero(numero as string);
    if (!normalizado) return null;
    return { mensagem, numero: normalizado };
  }

  if (telefoneId !== undefined && (typeof telefoneId !== 'string' || telefoneId.trim() === '')) {
    return null;
  }

  return { mensagem, leadId: leadId as string, telefoneId: telefoneId as string | undefined };
}

export async function POST(request: NextRequest) {
  const contexto = await resolverContexto(request);
  if (!contexto) return semSessao();

  const corpoBruto = await request.json().catch(() => null);
  const corpo = validarCorpo(corpoBruto);
  if (!corpo) return requisicaoInvalida();

  const db = getDb();
  let numeroDestino: string;

  if (corpo.leadId) {
    if (!UUID.test(corpo.leadId)) return leadNaoEncontrado();

    const telefones = await listarTelefonesLead(db, contexto, corpo.leadId);
    if (!telefones) return leadNaoEncontrado();

    if (corpo.telefoneId) {
      if (!UUID.test(corpo.telefoneId)) return telefoneNaoEncontrado();
      const extra = telefones.extras.find((telefone) => telefone.id === corpo.telefoneId);
      if (!extra) return telefoneNaoEncontrado();
      numeroDestino = extra.numero;
    } else {
      if (!telefones.principal) return leadSemTelefone();
      numeroDestino = telefones.principal;
    }
  } else {
    numeroDestino = corpo.numero as string;
  }

  const nomeInstancia = await buscarNomeInstancia(db, contexto);
  if (!nomeInstancia) return whatsappNaoConfigurado();

  const config = buildConfig(nomeInstancia);

  let resultadoEnvio;
  try {
    resultadoEnvio = await sendTextMessage(config, numeroDestino, corpo.mensagem);
  } catch {
    return falhaEnvio();
  }

  if (resultadoEnvio.error) {
    return resultadoEnvio.numberNotFound ? numeroSemWhatsapp() : falhaEnvio();
  }

  try {
    const registrado = await registrarMensagemEnviada(db, contexto, {
      numero: numeroDestino,
      texto: corpo.mensagem,
      evolutionMessageId: resultadoEnvio.key?.id ?? null,
    });
    return NextResponse.json({
      success: true,
      messageId: resultadoEnvio.key?.id ?? null,
      mensagemId: registrado.mensagemId,
      leadId: registrado.leadId,
    });
  } catch {
    // ASM-041: a Evolution já aceitou e entregou a mensagem — não há como
    // desfazer o envio, só sinalizar que o registro falhou.
    return NextResponse.json({ codigo: 'ENVIADO_SEM_REGISTRO' }, { status: 500 });
  }
}

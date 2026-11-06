// T-069 (fase2c-whatsapp-entrada, US-039): rota POST /api/whatsapp/webhook —
// substitui a legada em Supabase (createClient de '@supabase/supabase-js').
// Sem sessão (ASM-034): resolve a empresa pelo `empresa_id` da query, nunca
// por um usuário logado. Ordem: valida o formato de `empresa_id` (400, sem
// tocar o banco) → valida o segredo (401 uniforme para ausente/errado/empresa
// inexistente — AC-119/AC-121, nunca revelando qual dos três) → só então lê o
// corpo (400 se não é JSON) → extrai as mensagens válidas (T-067) e grava
// cada uma (T-068), uma transação por item (`registrarMensagemRecebida` já
// abre a sua via `comTenant`). Erro de banco no meio de um item (AC-131)
// devolve 500 para a Evolution retentar, sem seguir para os itens seguintes
// — mas um item anterior do mesmo array que já tinha sido gravado com
// sucesso permanece gravado, porque a transação dele já foi concluída.
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { extrairMensagens, type EvolutionWebhookPayload } from '../../../../domain/whatsapp/extrair-mensagem';
import { eventoDeAtualizacao, extrairAtualizacoesDeStatus, type PayloadDeAtualizacao } from '../../../../domain/whatsapp/extrair-status';
import { extrairReacoes, type PayloadComReacoes } from '../../../../domain/whatsapp/extrair-reacao';
import { atualizarStatusDaMensagem, registrarMensagemRecebida, registrarReacao, verificarSegredoWebhook } from '../../../../repositories/whatsapp';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requisicaoInvalida() {
  return NextResponse.json({ codigo: 'REQUISICAO_INVALIDA' }, { status: 400 });
}

function naoAutorizado() {
  return NextResponse.json({ codigo: 'NAO_AUTORIZADO' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const busca = request.nextUrl.searchParams;
  const empresaId = busca.get('empresa_id');
  if (!empresaId || !UUID.test(empresaId)) return requisicaoInvalida();

  const db = getDb();
  const autorizado = await verificarSegredoWebhook(db, empresaId, busca.get('secret'));
  if (!autorizado) return naoAutorizado();

  const payload: EvolutionWebhookPayload | null = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return requisicaoInvalida();

  // `messages.update`: os checks (entregue/lida) das mensagens que a empresa enviou.
  if (eventoDeAtualizacao(payload.event)) {
    try {
      for (const atualizacao of extrairAtualizacoesDeStatus(payload as PayloadDeAtualizacao)) {
        await atualizarStatusDaMensagem(db, { empresaId }, atualizacao);
      }
    } catch {
      return NextResponse.json({ codigo: 'ERRO_INTERNO' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Reações (emoji) do contato — ou da empresa, pelo celular — a mensagens que já estão no CRM.
  try {
    for (const reacao of extrairReacoes(payload as PayloadComReacoes)) {
      await registrarReacao(db, { empresaId }, reacao);
    }
  } catch {
    return NextResponse.json({ codigo: 'ERRO_INTERNO' }, { status: 500 });
  }

  const mensagens = extrairMensagens(payload);

  try {
    for (const mensagem of mensagens) {
      await registrarMensagemRecebida(db, { empresaId }, mensagem);
    }
  } catch {
    return NextResponse.json({ codigo: 'ERRO_INTERNO' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

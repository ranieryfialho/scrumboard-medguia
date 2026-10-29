// T-251 (fase5-whatsapp-lote-disparo, US-163, ASM-248): o worker do lote de WhatsApp. Chamado pelo cron a cada
// minuto, trabalha até `orcamentoMs`: por empresa com lote em andamento, manda UM item por vez e dorme o
// intervalo sorteado (15 a 45 s) antes do seguinte; o que não couber no orçamento fica para a próxima chamada,
// que respeita `proximo_envio_em`. Relógio, sono, sorteio e envio são injetáveis (testes sem Evolution real).
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { empresas } from '../../db/schema';
import { buildConfig, sendTextMessage } from '../evolution-api';
import { comTenant } from '../../repositories/contexto';
import { lerConsentimento } from '../../repositories/lead-consentimento';
import { registrarMensagemEnviada } from '../../repositories/whatsapp';
import { buscarNomeInstancia } from '../../repositories/whatsapp-instancia';
import { reivindicarProximoItem, registrarResultadoDoItem, type ItemParaEnviar } from '../../repositories/whatsapp-lote';
import { sortearIntervaloSegundos } from './lote-regras';

export type ResultadoDoEnvio = { ok: true; messageId: string | null } | { ok: false; erro: 'NUMERO_SEM_WHATSAPP' | 'FALHA_ENVIO' | 'WHATSAPP_NAO_CONFIGURADO' };
export type EnviarTexto = (empresaId: string, numero: string, texto: string) => Promise<ResultadoDoEnvio>;

export interface OpcoesDoWorker {
  agora?: () => Date;
  dormir?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
  orcamentoMs?: number;
  enviar?: EnviarTexto;
}
export interface ResumoDoWorker {
  empresas: number;
  enviados: number;
  falhas: number;
  cancelados: number;
}

export const ORCAMENTO_PADRAO_MS = 55_000;

/** O envio de verdade: a instância Evolution da empresa. */
export function criarEnvioPelaEvolution(db: NodePgDatabase): EnviarTexto {
  return async (empresaId, numero, texto) => {
    const nomeInstancia = await buscarNomeInstancia(db, { empresaId });
    if (!nomeInstancia) return { ok: false, erro: 'WHATSAPP_NAO_CONFIGURADO' };
    try {
      const r = await sendTextMessage(buildConfig(nomeInstancia), numero, texto);
      if (r.error) return { ok: false, erro: r.numberNotFound ? 'NUMERO_SEM_WHATSAPP' : 'FALHA_ENVIO' };
      return { ok: true, messageId: r.key?.id ?? null };
    } catch {
      return { ok: false, erro: 'FALHA_ENVIO' };
    }
  };
}

async function empresasComLoteEmAndamento(db: NodePgDatabase): Promise<string[]> {
  const todas = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.ativo, true));
  const comLote: string[] = [];
  for (const { id } of todas) {
    const achou = await comTenant(db, { empresaId: id }, async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from whatsapp_lotes where status = 'em_andamento'`);
      return (r.rows[0]?.n ?? 0) > 0;
    });
    if (achou) comLote.push(id);
  }
  return comLote;
}

async function processarEmpresa(db: NodePgDatabase, empresaId: string, o: Required<OpcoesDoWorker>, inicio: number, resumo: ResumoDoWorker): Promise<void> {
  const contexto = { empresaId };
  while (o.agora().getTime() - inicio < o.orcamentoMs) {
    const item: ItemParaEnviar | null = await reivindicarProximoItem(db, contexto, o.agora());
    if (!item) return;
    const intervalo = sortearIntervaloSegundos(o.aleatorio);

    // ASM-250: o consentimento vale na hora do envio; revogado, o item sai sem contar para o intervalo.
    const consentimento = item.leadId ? await lerConsentimento(db, { empresaId, usuarioId: '', papel: 'ATENDENTE', isSuperAdmin: false }, item.leadId) : null;
    if (!consentimento?.consentimento) {
      await registrarResultadoDoItem(db, contexto, item, { status: 'cancelado', erro: 'SEM_CONSENTIMENTO' }, o.agora(), intervalo);
      resumo.cancelados += 1;
      continue;
    }

    const envio = await o.enviar(empresaId, item.telefone, item.mensagem);
    if (envio.ok) {
      try {
        await registrarMensagemEnviada(db, contexto, { numero: item.telefone, texto: item.mensagem, evolutionMessageId: envio.messageId });
      } catch {
        // a mensagem saiu; só o registro na conversa falhou — o item continua "enviado"
      }
      await registrarResultadoDoItem(db, contexto, item, { status: 'enviado' }, o.agora(), intervalo);
      resumo.enviados += 1;
    } else {
      await registrarResultadoDoItem(db, contexto, item, { status: 'falhou', erro: envio.erro }, o.agora(), intervalo);
      resumo.falhas += 1;
    }

    // AC-679: o intervalo vale de verdade; se não couber no orçamento, o resto fica para a próxima chamada.
    if (item.restantes === 0 || o.agora().getTime() - inicio + intervalo * 1000 >= o.orcamentoMs) return;
    await o.dormir(intervalo * 1000);
  }
}

/** AC-679/AC-682: processa os lotes em andamento de todas as empresas (cada empresa no seu ritmo). */
export async function processarLotes(db: NodePgDatabase, opcoes: OpcoesDoWorker = {}): Promise<ResumoDoWorker> {
  const o: Required<OpcoesDoWorker> = {
    agora: opcoes.agora ?? (() => new Date()),
    dormir: opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    aleatorio: opcoes.aleatorio ?? Math.random,
    orcamentoMs: opcoes.orcamentoMs ?? ORCAMENTO_PADRAO_MS,
    enviar: opcoes.enviar ?? criarEnvioPelaEvolution(db),
  };
  const inicio = o.agora().getTime();
  const ids = await empresasComLoteEmAndamento(db);
  const resumo: ResumoDoWorker = { empresas: ids.length, enviados: 0, falhas: 0, cancelados: 0 };
  await Promise.all(ids.map((id) => processarEmpresa(db, id, o, inicio, resumo)));
  return resumo;
}

// T-251 (fase5-whatsapp-lote-disparo, AC-682): `POST /api/cron/whatsapp-lote` — o worker do lote de WhatsApp, chamado pelo
// agendador a cada minuto com o segredo do cron (`Authorization: Bearer`). Processa os lotes em andamento de todas as
// empresas dentro de ~55 s (um envio por vez, com 15 a 45 s entre eles) e registra a execução em `cron_execucoes`.
import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../../db/client';
import { cronExecucoes } from '../../../../db/schema';
import { getCronSegredo } from '../../../../lib/env';
import { processarLotes } from '../../../../lib/whatsapp/lote-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'whatsapp-lote';
const PREFIXO_BEARER = 'Bearer ';

function autorizado(request: NextRequest): boolean {
  const cabecalho = request.headers.get('authorization');
  if (!cabecalho || !cabecalho.startsWith(PREFIXO_BEARER)) return false;
  const recebido = Buffer.from(cabecalho.slice(PREFIXO_BEARER.length));
  const esperado = Buffer.from(getCronSegredo());
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ codigo: 'NAO_AUTORIZADO' }, { status: 401 });

  const db = getDb();
  const [execucao] = await db.insert(cronExecucoes).values({ job: JOB, status: 'em_execucao' }).returning();
  try {
    const resumo = await processarLotes(db);
    const itens = resumo.enviados + resumo.falhas + resumo.cancelados;
    await db.update(cronExecucoes).set({ status: 'sucesso', concluidoEm: new Date(), itensProcessados: itens }).where(eq(cronExecucoes.id, execucao.id));
    return NextResponse.json({ ok: true, ...resumo });
  } catch (erro) {
    await db
      .update(cronExecucoes)
      .set({ status: 'falha', concluidoEm: new Date(), erro: erro instanceof Error ? erro.message : String(erro) })
      .where(eq(cronExecucoes.id, execucao.id));
    return NextResponse.json({ codigo: 'FALHA_NO_JOB' }, { status: 500 });
  }
}

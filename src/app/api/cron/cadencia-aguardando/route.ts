// Cron de minuto em minuto (Bearer CRON_SEGREDO, como /api/cron/cadencia): expira os toques de WhatsApp "aguardando resposta" vencidos.
import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { cronExecucoes } from '../../../../db/schema';
import { getDb } from '../../../../db/client';
import { getCronSegredo } from '../../../../lib/env';
import { expirarAguardandosDeTodasAsEmpresas } from '../../../../repositories/cadencia';

export const dynamic = 'force-dynamic';

const JOB = 'cadencia-aguardando';
const PREFIXO_BEARER = 'Bearer ';

/** AC-202: compara o `Bearer` recebido contra `CRON_SEGREDO` em tempo constante; sem o cabeçalho, `false` sem comparar. */
function autorizado(request: NextRequest): boolean {
  const cabecalho = request.headers.get('authorization');
  if (!cabecalho || !cabecalho.startsWith(PREFIXO_BEARER)) return false;

  const recebido = Buffer.from(cabecalho.slice(PREFIXO_BEARER.length));
  const esperado = Buffer.from(getCronSegredo());
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/** Cadência: a cada minuto, conclui como `sem_resposta` os toques de WhatsApp "aguardando resposta" cujo prazo venceu (todos os tenants ativos), auditado em `cron_execucoes`. */
export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ codigo: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const db = getDb();
  const [execucao] = await db.insert(cronExecucoes).values({ job: JOB, status: 'em_execucao' }).returning();

  try {
    const resultadosPorEmpresa = await expirarAguardandosDeTodasAsEmpresas(db, new Date());
    const itensProcessados = resultadosPorEmpresa.reduce((total, resultado) => total + resultado.expirados, 0);

    await db
      .update(cronExecucoes)
      .set({ status: 'sucesso', itensProcessados, concluidoEm: new Date() })
      .where(eq(cronExecucoes.id, execucao.id));

    return NextResponse.json({ status: 'sucesso', itensProcessados });
  } catch (erro) {
    await db
      .update(cronExecucoes)
      .set({
        status: 'falha',
        erro: erro instanceof Error ? erro.message : String(erro),
        concluidoEm: new Date(),
      })
      .where(eq(cronExecucoes.id, execucao.id));

    return NextResponse.json({ codigo: 'ERRO_INTERNO' }, { status: 500 });
  }
}

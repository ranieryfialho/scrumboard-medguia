// T-093 (fase2b-cadencia, US-055): rota interna `POST /api/cron/cadencia` —
// job diário de virada de dia (ASM-058). A regra de negócio em si (quem
// avança, fim de semana/feriado não viram o dia, esgotar os 18 toques)
// já é toda de `virar_dia_cadencia` (T-089, SQL) e de
// `virarDiaDeTodasAsEmpresas` (T-090, repositório) — AC-199/AC-200/AC-201
// continuam provados nessas duas camadas; aqui o que se prova de novo é só
// o que é desta rota: segredo, auditoria e o fato de varrer todos os
// tenants numa única chamada (AC-203).
//
// Protegida por `Authorization: Bearer <CRON_SEGREDO>` (ASM-058), comparado
// em tempo constante — mesmo padrão de `verificarSegredoWebhook`
// (src/repositories/whatsapp.ts) e `assinaturaValida`
// (src/lib/anexos/assinatura.ts): sem o cabeçalho, ou com um valor que não
// bate byte a byte, a resposta é 401 e nada é tocado no banco (nem a
// gravação em `cron_execucoes`), igual o Dado de AC-202 pede.
//
// Idempotência "dentro do mesmo dia" (AC-202) não é lógica desta rota: a
// segunda chamada chama a mesma função SQL, que já não encontra nenhum card
// com zero pendentes para avançar de novo (o bloco gerado na primeira
// passada nasceu pendente) — por isso aqui só se grava a execução, sem
// checar "já rodei hoje?" antes.
import { timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { cronExecucoes } from '../../../../db/schema';
import { getDb } from '../../../../db/client';
import { getCronSegredo } from '../../../../lib/env';
import { virarDiaDeTodasAsEmpresas } from '../../../../repositories/cadencia';

export const dynamic = 'force-dynamic';

const JOB = 'cadencia-virada-dia';
const PREFIXO_BEARER = 'Bearer ';

/** AC-202: compara o `Bearer` recebido contra `CRON_SEGREDO` em tempo constante; sem o cabeçalho, `false` sem comparar. */
function autorizado(request: NextRequest): boolean {
  const cabecalho = request.headers.get('authorization');
  if (!cabecalho || !cabecalho.startsWith(PREFIXO_BEARER)) return false;

  const recebido = Buffer.from(cabecalho.slice(PREFIXO_BEARER.length));
  const esperado = Buffer.from(getCronSegredo());
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/** AC-199/AC-200/AC-201/AC-202/AC-203: virada de dia diária, uma vez por todos os tenants ativos, auditada em `cron_execucoes`. */
export async function POST(request: NextRequest) {
  if (!autorizado(request)) {
    return NextResponse.json({ codigo: 'NAO_AUTORIZADO' }, { status: 401 });
  }

  const db = getDb();
  const [execucao] = await db.insert(cronExecucoes).values({ job: JOB, status: 'em_execucao' }).returning();

  try {
    const resultadosPorEmpresa = await virarDiaDeTodasAsEmpresas(db, new Date());
    const itensProcessados = resultadosPorEmpresa.reduce(
      (total, resultado) => total + resultado.oportunidadesAvancadas.length,
      0
    );

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

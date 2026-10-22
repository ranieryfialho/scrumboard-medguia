// T-133 (fase3-espelho-sheets, US-094): consulta os cards da empresa do
// Sheets para o espelho — só leitura, sem nenhuma escrita no banco. A
// montagem das linhas (T-132, `linhas.ts`) é pura; este módulo só traduz o
// que está no Postgres para o formato `CardEspelho` que ela espera.
//
// AC-331 / ASM-118: o espelho só cobre a empresa `medguia` — mesma
// constante usada pelo worker (`EMPRESA_SLUG` em `src/worker/index.ts`).
// Como esta consulta roda fora de um `ContextoTenant` de requisição (é um
// job do worker, não uma ação de um usuário logado), ela filtra
// explicitamente por `empresa_id` em vez de passar por `comTenant`/RLS —
// mesmo padrão de `buscarEmpresaId` em `src/worker/index.ts`.
//
// AC-330 / ASM-117: "tentativas" é a contagem de `cadencia_atividades` da
// oportunidade com `resultado <> 'pendente'`. Um card sem cadência
// (`cadencia_dia`/`cadencia_turno` nulos) não tem bloco de cadência no
// resultado — a linha correspondente fica em branco (regra de
// `linhas.ts`).
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import {
  cadenciaAtividades,
  empresas,
  leads,
  motivosPerda,
  oportunidades,
  pipelineEtapas,
  usuarios,
} from '../db/schema';
import type { CardEspelho, Turno } from './linhas';

const EMPRESA_SLUG_ESPELHO = 'medguia';

/**
 * Busca todos os cards da empresa `medguia` (AC-331), já no formato que
 * `montarLinhasDoEspelho` espera, incluindo o estado da cadência (AC-330)
 * quando o card estiver em cadência.
 */
export async function consultarCardsDoEspelho(db: NodePgDatabase): Promise<CardEspelho[]> {
  const [empresa] = await db
    .select({ id: empresas.id })
    .from(empresas)
    .where(eq(empresas.slug, EMPRESA_SLUG_ESPELHO));
  if (!empresa) return [];

  const cards = await db
    .select({
      id: oportunidades.id,
      nome: leads.nome,
      telefone: leads.telefoneE164,
      email: leads.email,
      etapa: pipelineEtapas.nome,
      responsavel: usuarios.nome,
      valor: oportunidades.valor,
      motivoPerda: motivosPerda.nome,
      criadoEm: oportunidades.criadoEm,
      atualizadoEm: oportunidades.atualizadoEm,
      cadenciaDia: oportunidades.cadenciaDia,
      cadenciaTurno: oportunidades.cadenciaTurno,
      proximaAcaoEm: oportunidades.proximaAcaoEm,
    })
    .from(oportunidades)
    .innerJoin(leads, eq(oportunidades.leadId, leads.id))
    .leftJoin(pipelineEtapas, eq(oportunidades.etapaId, pipelineEtapas.id))
    .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
    .leftJoin(motivosPerda, eq(oportunidades.motivoPerdaId, motivosPerda.id))
    .where(eq(oportunidades.empresaId, empresa.id))
    .orderBy(oportunidades.criadoEm);

  if (cards.length === 0) return [];

  const idsDasOportunidades = cards.map((card) => card.id);
  const tentativasPorOportunidade = await db
    .select({ oportunidadeId: cadenciaAtividades.oportunidadeId, tentativas: count() })
    .from(cadenciaAtividades)
    .where(
      and(
        inArray(cadenciaAtividades.oportunidadeId, idsDasOportunidades),
        ne(cadenciaAtividades.resultado, 'pendente')
      )
    )
    .groupBy(cadenciaAtividades.oportunidadeId);

  const mapaDeTentativas = new Map(
    tentativasPorOportunidade.map((linha) => [linha.oportunidadeId, Number(linha.tentativas)])
  );

  return cards.map((card) => {
    const emCadencia = card.cadenciaDia != null && card.cadenciaTurno != null;

    return {
      nome: card.nome,
      telefone: card.telefone,
      email: card.email,
      etapa: card.etapa ?? '',
      responsavel: card.responsavel,
      valor: card.valor == null ? null : Number(card.valor),
      motivoPerda: card.motivoPerda,
      criadoEm: card.criadoEm,
      atualizadoEm: card.atualizadoEm,
      cadencia: emCadencia
        ? {
            dia: card.cadenciaDia as 1 | 2 | 3,
            turno: card.cadenciaTurno as Turno,
            tentativas: mapaDeTentativas.get(card.id) ?? 0,
            proximaAcaoEm: card.proximaAcaoEm,
          }
        : null,
    };
  });
}

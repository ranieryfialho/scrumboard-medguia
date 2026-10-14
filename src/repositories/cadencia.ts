// T-090 (fase2b-cadencia, US-053/US-054/US-055): repositório do motor de
// cadência. Mesmas regras de oportunidades.ts/anexos.ts: tudo passa por
// `comTenant` (T-040) — o RLS (0001) é quem garante AC-203 (cada empresa só
// vê e vira os próprios cards), não um filtro manual aqui dentro.
//
// `iniciarCadencia` e `concluirAtividade` só chamam as funções SQL de T-089
// (`iniciar_cadencia`, `concluir_atividade_cadencia`) pelo efeito —
// igual a `moverOportunidade` em oportunidades.ts, o valor de retorno da
// função SQL é ignorado e a linha é relida pela query builder depois, já
// com os nomes de coluna em camelCase que o resto do app espera. As duas
// funções levantam sempre `ERRCODE = 'P0001'`, diferenciadas só pelo prefixo
// da mensagem (`CONFLITO_DE_VERSAO`, `TURNO_NAO_LIBERADO`,
// `BLOCO_ANTERIOR_PENDENTE`, `CADENCIA_ENCERRADA`) — `lancarErroDeCadencia`
// traduz isso num erro tipado; qualquer outro prefixo (ex.: validação
// interna que não deveria escapar até aqui) sobe sem alteração.
//
// `listarFilaDoTurno` (AC-192) nunca lê o relógio real: `filtro.agora` é
// sempre recebido por parâmetro (ASM-062), e o turno/dia útil vêm do domínio
// puro de T-088 (`turnoVigente`, `podeLiberar`). Fora de turno ou em dia não
// útil, a função nem chega a consultar o banco — devolve lista vazia direto.
//
// `virarDiaDeTodasAsEmpresas` varre as empresas ativas e chama
// `virar_dia_cadencia` uma vez por tenant, cada uma na própria transação
// (`comTenant` abre uma por chamada) — uma falha numa empresa não derruba a
// virada das demais.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { cadenciaAtividades, empresas, oportunidades } from '../db/schema';
import { podeLiberar } from '../domain/cadencia/feriados';
import { turnoVigente, type Turno } from '../domain/cadencia/turno';
import type { ContextoTenant } from '../lib/auth/tenant';
import { comTenant } from './contexto';

export type Oportunidade = typeof oportunidades.$inferSelect;
export type AtividadeCadencia = typeof cadenciaAtividades.$inferSelect;

export type AtorTipo = 'usuario' | 'sistema' | 'migracao';
export type ResultadoToque = 'sem_resposta' | 'conectou';

/** `version` informada não bate com a `version` atual do card (lock otimista, mesmo ERRCODE das demais funções SQL da feature). */
export class ErroConflitoDeVersao extends Error {
  constructor() {
    super('A oportunidade foi alterada por outra ação; recarregue e tente novamente.');
    this.name = 'ErroConflitoDeVersao';
  }
}

/** AC-196: o bloco da tarde do toque ainda não libera antes das 13h em `America/Sao_Paulo`. */
export class ErroTurnoNaoLiberado extends Error {
  constructor() {
    super('O bloco da tarde só libera a partir das 13h em America/Sao_Paulo.');
    this.name = 'ErroTurnoNaoLiberado';
  }
}

/** AC-196: o `(dia, turno)` do toque não é o bloco corrente liberado da oportunidade. */
export class ErroBlocoAnteriorPendente extends Error {
  constructor() {
    super('O bloco anterior ainda não foi concluído.');
    this.name = 'ErroBlocoAnteriorPendente';
  }
}

/** AC-197: a cadência já foi encerrada (conectou, esgotamento) ou o toque não está mais pendente. */
export class ErroCadenciaEncerrada extends Error {
  constructor() {
    super('A cadência deste card já foi encerrada, ou este toque não está mais pendente.');
    this.name = 'ErroCadenciaEncerrada';
  }
}

const ERRCODE_REGRA_DE_CADENCIA = 'P0001';

/**
 * O driver `pg` expõe o SQLSTATE em `error.code`, mas o Drizzle (node-postgres)
 * embrulha esse erro num `DrizzleQueryError` cuja causa (`error.cause`) é o
 * erro original do `pg` — checa os dois formatos (mesmo helper de
 * oportunidades.ts/whatsapp-config.ts).
 */
function erroPostgres(erro: unknown): { code?: string; message?: string } {
  if (!erro || typeof erro !== 'object') return {};
  const comCodigo = erro as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  // O Drizzle (node-postgres) embrulha o erro original do `pg` num
  // `DrizzleQueryError` cuja própria `.message` é sempre "Failed query: ..."
  // (nunca o texto do `RAISE EXCEPTION`) — por isso a causa tem prioridade
  // aqui; só cai pro erro externo se não houver `cause` nenhuma.
  return {
    code: comCodigo.cause?.code ?? comCodigo.code,
    message: comCodigo.cause?.message ?? comCodigo.message,
  };
}

/** Traduz o `RAISE EXCEPTION 'CODIGO: ...' USING ERRCODE = 'P0001'` das funções SQL de T-089 num erro tipado. */
function lancarErroDeCadencia(erro: unknown): never {
  const { code, message } = erroPostgres(erro);
  if (code === ERRCODE_REGRA_DE_CADENCIA && message) {
    if (message.includes('CONFLITO_DE_VERSAO')) throw new ErroConflitoDeVersao();
    if (message.includes('TURNO_NAO_LIBERADO')) throw new ErroTurnoNaoLiberado();
    if (message.includes('BLOCO_ANTERIOR_PENDENTE')) throw new ErroBlocoAnteriorPendente();
    if (message.includes('CADENCIA_ENCERRADA')) throw new ErroCadenciaEncerrada();
  }
  throw erro;
}

export interface DadosIniciarCadencia {
  /** `version` que o chamador acredita ser a atual — lock otimista (AC-191). */
  version: number;
  atorId: string;
  atorTipo: AtorTipo;
}

export interface ResultadoIniciarCadencia {
  oportunidade: Oportunidade;
  /** AC-190: sempre os 3 toques do bloco (dia 1, manhã) — sequências 1-3. */
  toques: AtividadeCadencia[];
}

/**
 * Inicia a cadência de um card (AC-190) chamando `iniciar_cadencia` (T-089)
 * sob o tenant do `contexto`. Rejeita (`ErroConflitoDeVersao`) sem gravar
 * nada se `dados.version` não bater com a `version` atual (AC-191).
 */
export async function iniciarCadencia(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  dados: DadosIniciarCadencia
): Promise<ResultadoIniciarCadencia> {
  return comTenant(db, contexto, async (tx) => {
    try {
      await tx.execute(sql`
        select iniciar_cadencia(
          ${oportunidadeId}::uuid,
          ${dados.version}::integer,
          ${dados.atorId}::uuid,
          ${dados.atorTipo}::ator_tipo,
          null::jsonb
        )
      `);
    } catch (erro) {
      lancarErroDeCadencia(erro);
    }

    const [oportunidade] = await tx
      .select()
      .from(oportunidades)
      .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .limit(1);

    const toques = await tx
      .select()
      .from(cadenciaAtividades)
      .where(
        and(eq(cadenciaAtividades.oportunidadeId, oportunidadeId), eq(cadenciaAtividades.empresaId, contexto.empresaId))
      )
      .orderBy(asc(cadenciaAtividades.sequencia));

    return { oportunidade, toques };
  });
}

export interface DadosConcluirAtividade {
  /** `version` que o chamador acredita ser a atual do card da atividade (lock otimista, AC-198). */
  version: number;
  resultado: ResultadoToque;
  atorId: string;
  atorTipo: AtorTipo;
  /** Relógio injetado (ASM-062) — nunca `Date.now()` real. */
  agora: Date;
}

/**
 * Conclui um toque (AC-193: `sem_resposta` registra o fato; AC-195:
 * `conectou` encerra a cadência na hora) chamando
 * `concluir_atividade_cadencia` (T-089) sob o tenant do `contexto`. Nada é
 * gravado quando a função SQL recusa (`ErroConflitoDeVersao`,
 * `ErroTurnoNaoLiberado`, `ErroBlocoAnteriorPendente`,
 * `ErroCadenciaEncerrada`) — a transação é desfeita por inteiro.
 */
export async function concluirAtividade(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  atividadeId: string,
  dados: DadosConcluirAtividade
): Promise<AtividadeCadencia> {
  return comTenant(db, contexto, async (tx) => {
    try {
      await tx.execute(sql`
        select concluir_atividade_cadencia(
          ${atividadeId}::uuid,
          ${dados.version}::integer,
          ${dados.resultado}::cadencia_resultado,
          ${dados.atorId}::uuid,
          ${dados.atorTipo}::ator_tipo,
          ${dados.agora.toISOString()}::timestamptz,
          null::jsonb
        )
      `);
    } catch (erro) {
      lancarErroDeCadencia(erro);
    }

    const [atividade] = await tx
      .select()
      .from(cadenciaAtividades)
      .where(and(eq(cadenciaAtividades.id, atividadeId), eq(cadenciaAtividades.empresaId, contexto.empresaId)))
      .limit(1);

    return atividade;
  });
}

export interface FiltroFilaDoTurno {
  /**
   * Restringe aos cards deste responsável (ASM-061: ATENDENTE só os
   * próprios). Omitido, traz os toques pendentes do turno vigente de todo o
   * tenant (MASTER/GERENTE/super admin) — a decisão de qual usar é da rota
   * (T-092), não deste repositório.
   */
  responsavelId?: string;
  /** Relógio injetado (ASM-062) — nunca `Date.now()` real. */
  agora: Date;
}

export interface ItemFilaCadencia {
  atividade: AtividadeCadencia;
  oportunidade: Oportunidade;
}

/**
 * Fila "Minhas tarefas" do turno vigente (AC-192): só os toques `pendente`
 * do turno corrente, dos cards do tenant do `contexto` (e, se informado, do
 * `responsavelId`). Fora de turno (12h-13h, antes das 8h, a partir das 18h),
 * fim de semana ou feriado nacional (T-088), a lista vem vazia sem nem
 * consultar o banco. O bloco da tarde só aparece porque só existe no banco a
 * partir do terceiro `sem_resposta` da manhã (AC-194) — a conclusão da
 * manhã já é pré-condição para a atividade da tarde existir.
 */
export async function listarFilaDoTurno(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroFilaDoTurno
): Promise<ItemFilaCadencia[]> {
  if (!podeLiberar(filtro.agora)) return [];

  const turno: Turno | null = turnoVigente(filtro.agora);
  if (!turno) return [];

  return comTenant(db, contexto, async (tx) => {
    const condicoes = [
      eq(cadenciaAtividades.empresaId, contexto.empresaId),
      eq(cadenciaAtividades.resultado, 'pendente'),
      eq(cadenciaAtividades.turno, turno),
      eq(oportunidades.empresaId, contexto.empresaId),
      isNull(oportunidades.cadenciaEncerradaEm),
    ];
    if (filtro.responsavelId !== undefined) {
      condicoes.push(eq(oportunidades.responsavelId, filtro.responsavelId));
    }

    const linhas = await tx
      .select({ atividade: cadenciaAtividades, oportunidade: oportunidades })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .where(and(...condicoes))
      .orderBy(asc(cadenciaAtividades.sequencia));

    return linhas;
  });
}

export interface ResultadoViradaDeEmpresa {
  empresaId: string;
  oportunidadesAvancadas: Oportunidade[];
}

/**
 * Varre as empresas ativas e chama `virar_dia_cadencia` (T-089) uma vez por
 * tenant, cada uma na própria transação (AC-203) — nunca mistura toque ou
 * card entre empresas. `empresas` não tem RLS (não é dado de negócio
 * dependente de tenant, é o próprio registro de tenants), então a listagem
 * inicial roda fora de `comTenant`.
 */
export async function virarDiaDeTodasAsEmpresas(
  db: NodePgDatabase,
  agora: Date
): Promise<ResultadoViradaDeEmpresa[]> {
  const empresasAtivas = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.ativo, true));

  const resultados: ResultadoViradaDeEmpresa[] = [];
  for (const empresa of empresasAtivas) {
    const oportunidadesAvancadas = await comTenant(db, { empresaId: empresa.id }, async (tx) => {
      const execucao = await tx.execute<{ id: string }>(
        sql`select id from virar_dia_cadencia(${agora.toISOString()}::timestamptz)`
      );
      const ids = execucao.rows.map((linha) => linha.id);
      if (ids.length === 0) return [];

      return tx
        .select()
        .from(oportunidades)
        .where(and(eq(oportunidades.empresaId, empresa.id), inArray(oportunidades.id, ids)));
    });

    resultados.push({ empresaId: empresa.id, oportunidadesAvancadas });
  }

  return resultados;
}

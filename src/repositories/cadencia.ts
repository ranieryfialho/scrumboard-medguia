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
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

import { cadenciaAtividades, empresas, leads, oportunidadeEventos, oportunidades, usuarios } from '../db/schema';
import { podeLiberar } from '../domain/cadencia/feriados';
import { dataLocalEmSaoPaulo, turnoVigente, type Turno } from '../domain/cadencia/turno';
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
  /**
   * Relógio injetado (ASM-062). Com ele, o primeiro bloco nasce no turno em que a cadência foi iniciada (AC-756: à tarde, o bloco da
   * tarde). Sem ele, o comportamento anterior: sempre o bloco de manhã, liberado agora.
   */
  agora?: Date;
}

export interface ResultadoIniciarCadencia {
  oportunidade: Oportunidade;
  /** AC-190/AC-756: os 3 toques do primeiro bloco — o de manhã (sequências 1-3) ou, iniciada à tarde, o da tarde (4-6). */
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
          null::jsonb,
          ${dados.agora ? dados.agora.toISOString() : null}::timestamptz
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

/** `true` se o card já tem (ou já teve) toques de cadência — iniciar de novo bateria no índice único de sequência. */
export async function cardTemToquesDeCadencia(db: NodePgDatabase, contexto: ContextoTenant, oportunidadeId: string): Promise<boolean> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({ id: cadenciaAtividades.id })
      .from(cadenciaAtividades)
      .where(and(eq(cadenciaAtividades.oportunidadeId, oportunidadeId), eq(cadenciaAtividades.empresaId, contexto.empresaId)))
      .limit(1);
    return Boolean(linha);
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

/** O prazo do "aguardando resposta" (ISO) se ainda vale em `agora`; senão `null` (nunca marcado ou já vencido). */
export function aguardandoVigente(atividade: { aguardandoAte: Date | null; resultado: string }, agora: Date): string | null {
  if (atividade.resultado !== 'pendente' || !atividade.aguardandoAte) return null;
  return atividade.aguardandoAte.getTime() > agora.getTime() ? atividade.aguardandoAte.toISOString() : null;
}

function responsavelDe(id: string | null, nome: string | null): { id: string; nome: string } | null {
  return id && nome ? { id, nome } : null;
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
  /**
   * AC-212: também inclui os toques `pendente` liberados em turno ou dia
   * anterior ao vigente (ASM-065), marcados `atrasado: true`. Omitido ou
   * `false`, a resposta é a de AC-192, inalterada.
   */
  incluirAtrasados?: boolean;
}

export interface ItemFilaCadencia {
  atividade: AtividadeCadencia;
  oportunidade: Oportunidade;
  /** AC-205: dados do lead exibidos em cada toque da fila. */
  lead: { id: string; nome: string; telefoneE164: string | null };
  /** AC-212: `true` só para os toques trazidos por `incluirAtrasados`. */
  atrasado: boolean;
  /** AC-469: instante em que o toque foi liberado (ISO). */
  liberadaEm: string | null;
  /** AC-469: responsável do card, ou `null` se não houver. */
  responsavel: { id: string; nome: string } | null;
  /** Toque de WhatsApp "aguardando resposta": o prazo (ISO) enquanto ainda vale; `null` se não está aguardando. Aguardando nunca é atrasado. */
  aguardandoAte: string | null;
}

/**
 * ASM-065: início do turno/dia "de referência" de `agora`, usado como corte
 * entre pendente "do turno vigente" e "atrasado" — ao contrário de
 * `turnoVigente` (T-088), não exige que `agora` esteja dentro da janela de
 * um turno (12h-13h, antes das 8h, a partir das 18h, fim de semana ou
 * feriado também precisam de um corte, para a seção "Atrasadas" continuar
 * funcionando fora do horário de atendimento). Antes das 13h o corte é
 * 08h00 do próprio dia (equivalente a "turno da manhã"), de 13h em diante é
 * 13h00 (equivalente a "turno da tarde") — `America/Sao_Paulo` não observa
 * horário de verão desde 2019, então hora local + 3h é sempre a hora UTC do
 * mesmo dia-calendário.
 */
export function inicioDoTurnoDeReferencia(agora: Date): Date {
  const local = dataLocalEmSaoPaulo(agora);
  const horaReferenciaLocal = local.hora < 13 ? 8 : 13;
  return new Date(Date.UTC(local.ano, local.mes - 1, local.dia, horaReferenciaLocal + 3));
}

/**
 * Fila "Minhas tarefas" do turno vigente (AC-192): só os toques `pendente`
 * do turno corrente, dos cards do tenant do `contexto` (e, se informado, do
 * `responsavelId`). Fora de turno (12h-13h, antes das 8h, a partir das 18h),
 * fim de semana ou feriado nacional (T-088), a parte "vigente" vem vazia
 * sem nem consultar o banco — mas `incluirAtrasados` (AC-212) ainda pode
 * trazer toques atrasados mesmo fora do horário de atendimento (ex.: sábado,
 * revendo o que ficou pendente de sexta). O bloco da tarde só aparece
 * porque só existe no banco a partir do terceiro `sem_resposta` da manhã
 * (AC-194) — a conclusão da manhã já é pré-condição para a atividade da
 * tarde existir.
 */
export async function listarFilaDoTurno(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  filtro: FiltroFilaDoTurno
): Promise<ItemFilaCadencia[]> {
  const turno: Turno | null = podeLiberar(filtro.agora) ? turnoVigente(filtro.agora) : null;

  if (!filtro.incluirAtrasados) {
    if (!turno) return [];

    return comTenant(db, contexto, async (tx) => {
      const condicoes: SQL[] = [
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
        .select({
          atividade: cadenciaAtividades,
          oportunidade: oportunidades,
          leadId: leads.id,
          leadNome: leads.nome,
          leadTelefoneE164: leads.telefoneE164,
          liberadaEm: sql<string | null>`to_char("cadencia_atividades"."liberada_em" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
          responsavelNome: usuarios.nome,
        })
        .from(cadenciaAtividades)
        .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
        .innerJoin(leads, eq(oportunidades.leadId, leads.id))
        .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
        .where(and(...condicoes))
        .orderBy(asc(cadenciaAtividades.sequencia));

      return linhas.map((linha) => ({
        atividade: linha.atividade,
        oportunidade: linha.oportunidade,
        lead: { id: linha.leadId, nome: linha.leadNome, telefoneE164: linha.leadTelefoneE164 },
        atrasado: false,
        liberadaEm: linha.liberadaEm,
        responsavel: responsavelDe(linha.oportunidade.responsavelId, linha.responsavelNome),
        aguardandoAte: aguardandoVigente(linha.atividade, filtro.agora),
      }));
    });
  }

  // AC-212/ASM-065: com `incluirAtrasados`, o corte deixa de ser só o
  // `turno` do toque — um toque `pendente` cujo `turno` ainda "bate" com o
  // vigente (ex.: ficou parado desde o dia anterior, e `virar_dia_cadencia`
  // não avança cards com pendente — comentário de T-089) também precisa
  // virar atrasado se foi liberado antes do corte. Por isso aqui cada linha
  // é classificada pelo próprio `liberada_em`, não só pela igualdade de
  // `turno` usada no ramo acima (que fica inalterado, AC-192).
  const corte = inicioDoTurnoDeReferencia(filtro.agora);

  return comTenant(db, contexto, async (tx) => {
    const condicoes: SQL[] = [
      eq(cadenciaAtividades.empresaId, contexto.empresaId),
      eq(cadenciaAtividades.resultado, 'pendente'),
      eq(oportunidades.empresaId, contexto.empresaId),
      isNull(oportunidades.cadenciaEncerradaEm),
    ];
    if (filtro.responsavelId !== undefined) {
      condicoes.push(eq(oportunidades.responsavelId, filtro.responsavelId));
    }

    const condicaoAtraso = sql`"cadencia_atividades"."liberada_em" < ${corte.toISOString()}::timestamptz`;
    condicoes.push(turno ? or(eq(cadenciaAtividades.turno, turno), condicaoAtraso)! : condicaoAtraso);

    const linhas = await tx
      .select({
        atividade: cadenciaAtividades,
        oportunidade: oportunidades,
        leadId: leads.id,
        leadNome: leads.nome,
        leadTelefoneE164: leads.telefoneE164,
        liberadaEm: sql<string>`to_char("cadencia_atividades"."liberada_em" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        responsavelNome: usuarios.nome,
      })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .innerJoin(leads, eq(oportunidades.leadId, leads.id))
      .leftJoin(usuarios, eq(oportunidades.responsavelId, usuarios.id))
      .where(and(...condicoes))
      .orderBy(asc(cadenciaAtividades.sequencia));

    const itens = linhas.map((linha) => {
      const aguardandoAte = aguardandoVigente(linha.atividade, filtro.agora);
      return {
        atividade: linha.atividade,
        oportunidade: linha.oportunidade,
        lead: { id: linha.leadId, nome: linha.leadNome, telefoneE164: linha.leadTelefoneE164 },
        // Aguardando resposta não é atraso: a mensagem já saiu e o toque só espera o lead (ou o prazo).
        atrasado: aguardandoAte === null && new Date(linha.liberadaEm).getTime() < corte.getTime(),
        liberadaEm: linha.liberadaEm,
        responsavel: responsavelDe(linha.oportunidade.responsavelId, linha.responsavelNome),
        aguardandoAte,
      };
    });

    // Atrasados primeiro (AC-213: a seção "Atrasadas" fica acima do turno
    // vigente); `sort` é estável, então a ordem por sequência de cada grupo
    // (já vinda do `orderBy` acima) se preserva.
    return itens.sort((a, b) => Number(b.atrasado) - Number(a.atrasado));
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


// ---------------------------------------------------------------------------
// "Aguardando resposta" (migration 0035)
// ---------------------------------------------------------------------------

/** Quanto tempo um toque de WhatsApp fica "aguardando resposta" antes de virar `sem_resposta` sozinho. */
export const MINUTOS_AGUARDANDO_RESPOSTA = 120;

/** O toque não é de WhatsApp: só mensagem enviada tem "aguardando resposta" (ligação atende ou não atende na hora). */
export class ErroToqueNaoAceitaAguardar extends Error {
  constructor() {
    super('Só toques de WhatsApp podem ficar aguardando resposta.');
    this.name = 'ErroToqueNaoAceitaAguardar';
  }
}

export interface DadosRegistrarRespostaDoLead {
  /** `version` que o chamador acredita ser a atual do card (lock otimista). */
  version: number;
  atorId: string;
  /** Relógio injetado (ASM-062). */
  agora: Date;
}

/**
 * "O lead respondeu" no nível do CARD, sem depender de um toque pendente. Entre o fim de um turno e a liberação do próximo bloco não
 * existe toque pendente (o banco só gera o bloco seguinte quando chega a hora), e o `conectou` de `concluirAtividade` precisa de um toque.
 * Aqui o efeito é o mesmo do `conectou` (e da conexão automática do WhatsApp): cancela os toques pendentes, encerra a cadência e leva o
 * card a Qualificando, tudo na mesma transação. Recusas: `ErroConflitoDeVersao` e `ErroCadenciaEncerrada` (já encerrada, ou card que
 * não está mais na régua, etapas 2 a 4).
 */
export async function registrarRespostaDoLead(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  oportunidadeId: string,
  dados: DadosRegistrarRespostaDoLead
): Promise<Oportunidade> {
  return comTenant(db, contexto, async (tx) => {
    const [oportunidade] = await tx
      .select()
      .from(oportunidades)
      .where(and(eq(oportunidades.id, oportunidadeId), eq(oportunidades.empresaId, contexto.empresaId)))
      .for('update')
      .limit(1);
    if (!oportunidade) throw new ErroCadenciaEncerrada();

    if (oportunidade.version !== dados.version) throw new ErroConflitoDeVersao();
    if (oportunidade.cadenciaEncerradaEm !== null || ![2, 3, 4].includes(oportunidade.etapaId)) throw new ErroCadenciaEncerrada();

    await tx
      .update(cadenciaAtividades)
      .set({ resultado: 'cancelada' })
      .where(and(eq(cadenciaAtividades.oportunidadeId, oportunidadeId), eq(cadenciaAtividades.resultado, 'pendente')));

    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId,
      tipo: 'lead_respondeu',
      atorId: dados.atorId,
      atorTipo: 'usuario',
      payload: { etapaOrigemId: oportunidade.etapaId },
    });

    // `mover_oportunidade` confere a version e a incrementa; a coluna de encerramento é gravada antes, como em `concluir_atividade_cadencia`.
    await tx
      .update(oportunidades)
      .set({ cadenciaEncerradaEm: dados.agora })
      .where(eq(oportunidades.id, oportunidadeId));
    try {
      await tx.execute(sql`
        select mover_oportunidade(
          ${oportunidadeId}::uuid,
          ${dados.version}::integer,
          5,
          ${dados.atorId}::uuid,
          'usuario'::ator_tipo,
          ${JSON.stringify({ origem: 'lead_respondeu' })}::jsonb
        )
      `);
    } catch (erro) {
      lancarErroDeCadencia(erro);
    }

    const [atual] = await tx.select().from(oportunidades).where(eq(oportunidades.id, oportunidadeId)).limit(1);
    return atual;
  });
}

export interface DadosMarcarAguardando {
  /** `version` que o chamador acredita ser a atual do card (lock otimista). */
  version: number;
  atorId: string;
  /** Relógio injetado (ASM-062). */
  agora: Date;
  /** Prazo em minutos; omitido, `MINUTOS_AGUARDANDO_RESPOSTA`. */
  minutos?: number;
}

/**
 * Marca o toque de WhatsApp como "aguardando resposta": a mensagem saiu e o lead ainda não respondeu. O toque continua `pendente` (a regra
 * dos blocos não muda) e só ganha o prazo; vencido, `expirarAguardandosDaEmpresa` conclui o toque como `sem_resposta`. Remarcar reinicia o
 * prazo. Mesmas recusas de `concluirAtividade` (versão, cadência encerrada, bloco), mais `ErroToqueNaoAceitaAguardar`.
 */
export async function marcarAguardandoResposta(
  db: NodePgDatabase,
  contexto: ContextoTenant,
  atividadeId: string,
  dados: DadosMarcarAguardando
): Promise<AtividadeCadencia> {
  return comTenant(db, contexto, async (tx) => {
    const [linha] = await tx
      .select({ atividade: cadenciaAtividades, oportunidade: oportunidades })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .where(and(eq(cadenciaAtividades.id, atividadeId), eq(cadenciaAtividades.empresaId, contexto.empresaId)))
      .for('update', { of: [cadenciaAtividades, oportunidades] })
      .limit(1);
    if (!linha) throw new ErroCadenciaEncerrada();
    const { atividade, oportunidade } = linha;

    if (oportunidade.version !== dados.version) throw new ErroConflitoDeVersao();
    if (oportunidade.cadenciaEncerradaEm !== null || atividade.resultado !== 'pendente') throw new ErroCadenciaEncerrada();
    if (atividade.canal !== 'whatsapp') throw new ErroToqueNaoAceitaAguardar();
    if (atividade.dia !== oportunidade.cadenciaDia || atividade.turno !== oportunidade.cadenciaTurno) throw new ErroBlocoAnteriorPendente();

    const ate = new Date(dados.agora.getTime() + (dados.minutos ?? MINUTOS_AGUARDANDO_RESPOSTA) * 60_000);
    const [atualizada] = await tx
      .update(cadenciaAtividades)
      .set({ aguardandoDesde: dados.agora, aguardandoAte: ate })
      .where(eq(cadenciaAtividades.id, atividadeId))
      .returning();

    await tx.insert(oportunidadeEventos).values({
      empresaId: contexto.empresaId,
      oportunidadeId: oportunidade.id,
      tipo: 'aguardando_resposta',
      atorId: dados.atorId,
      atorTipo: 'usuario',
      payload: { atividadeId, sequencia: atividade.sequencia, ate: ate.toISOString() },
    });

    return atualizada;
  });
}

export interface ResultadoExpiracao {
  empresaId: string;
  /** Toques concluídos como `sem_resposta` porque o prazo venceu. */
  expirados: number;
  /** Toques que o banco recusou (card mexido por outra ação etc.) — ficam para o próximo ciclo. */
  recusados: number;
}

/**
 * Conclui como `sem_resposta` os toques "aguardando resposta" cujo prazo venceu (`aguardando_ate <= agora`), de uma empresa. Cada toque roda
 * na própria transação, pelo mesmo `concluir_atividade_cadencia` do botão "Não atendeu" (então libera o bloco seguinte e esgota a cadência
 * quando for o caso), com `ator_tipo = sistema`. Um toque que o banco recusa (conflito, bloco, cadência já encerrada) não derruba os outros.
 */
export async function expirarAguardandosDaEmpresa(db: NodePgDatabase, empresaId: string, agora: Date): Promise<ResultadoExpiracao> {
  const vencidos = await comTenant(db, { empresaId }, async (tx) =>
    tx
      .select({ id: cadenciaAtividades.id, version: oportunidades.version })
      .from(cadenciaAtividades)
      .innerJoin(oportunidades, eq(cadenciaAtividades.oportunidadeId, oportunidades.id))
      .where(
        and(
          eq(cadenciaAtividades.empresaId, empresaId),
          eq(cadenciaAtividades.resultado, 'pendente'),
          sql`"cadencia_atividades"."aguardando_ate" <= ${agora.toISOString()}::timestamptz`,
          isNull(oportunidades.cadenciaEncerradaEm)
        )
      )
      .orderBy(asc(cadenciaAtividades.aguardandoAte))
  );

  let expirados = 0;
  let recusados = 0;
  for (const toque of vencidos) {
    try {
      await comTenant(db, { empresaId }, async (tx) => {
        await tx.execute(sql`
          select concluir_atividade_cadencia(
            ${toque.id}::uuid,
            ${toque.version}::integer,
            'sem_resposta'::cadencia_resultado,
            null::uuid,
            'sistema'::ator_tipo,
            ${agora.toISOString()}::timestamptz,
            ${JSON.stringify({ motivo: 'aguardando_resposta_expirou' })}::jsonb
          )
        `);
      });
      expirados += 1;
    } catch {
      recusados += 1;
    }
  }
  return { empresaId, expirados, recusados };
}

/** Varre as empresas ativas e expira, em cada uma, os toques "aguardando resposta" vencidos (cron de minuto em minuto). */
export async function expirarAguardandosDeTodasAsEmpresas(db: NodePgDatabase, agora: Date): Promise<ResultadoExpiracao[]> {
  const empresasAtivas = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.ativo, true));
  const resultados: ResultadoExpiracao[] = [];
  for (const empresa of empresasAtivas) resultados.push(await expirarAguardandosDaEmpresa(db, empresa.id, agora));
  return resultados;
}

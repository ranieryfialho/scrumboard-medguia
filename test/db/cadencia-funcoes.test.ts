// Testes de T-089 (fase2b-cadencia): prova, contra um Postgres 15 efêmero
// real com as migrations até 0011 aplicadas, que as três funções SQL do
// motor de cadência — `iniciar_cadencia`, `concluir_atividade_cadencia` e
// `virar_dia_cadencia` — fazem exatamente o que a spec define (AC-190,
// AC-193, AC-194, AC-195, AC-196, AC-197, AC-199, AC-200, AC-201, AC-203).
// As três rodam sem SECURITY DEFINER, então os testes chamam como `crm_app`
// com `SET app.empresa_id` — o mesmo caminho da aplicação em produção
// (mesmo padrão de test/db/funcoes.test.ts, T-024).
//
// `cadencia_bloco` (helper interno das três funções) replica em SQL a
// matriz pura de src/domain/cadencia/matriz.ts (`blocoDe`, T-088); o
// primeiro describe abaixo prova a paridade entre os dois lados para os 6
// blocos possíveis.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { blocoDe, type Dia } from '../../src/domain/cadencia/matriz';
import type { Turno } from '../../src/domain/cadencia/turno';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const ETAPA_ENTRADA = 1;
const ETAPA_1_DIA = 2;
const ETAPA_2_DIA = 3;
const ETAPA_QUALIFICANDO = 5;
const ETAPA_PERDIDO = 14;

const EMPRESA_A = 'cccccccc-0000-0000-0000-00000000000a';
const EMPRESA_B = 'cccccccc-0000-0000-0000-00000000000b';
const LEAD_A = 'cccccccc-0000-0000-0000-00000000001a';
const LEAD_B = 'cccccccc-0000-0000-0000-00000000001b';
const USUARIO_A = 'cccccccc-0000-0000-0000-00000000002a';
const USUARIO_B = 'cccccccc-0000-0000-0000-00000000002b';

// Datas fixas (ASM-062: o relógio é sempre recebido por parâmetro, nunca
// `Date.now()` real). 2026-06-10/11/12/15 são quarta/quinta/sexta/segunda —
// dias úteis comuns, fora da lista de feriados de T-088. 14h em
// America/Sao_Paulo libera a conclusão de qualquer toque (manhã nunca tem
// restrição de horário; tarde libera a partir das 13h).
const AGORA_TARDE_OK = '2026-06-10T14:00:00-03:00';
const AGORA_MANHA_ANTES_DAS_TARDE = '2026-06-10T09:00:00-03:00';
const DIA_UTIL = '2026-06-11T00:05:00-03:00';
const SABADO = '2026-06-13T10:00:00-03:00'; // 2026-01-03 é sábado; 06-13 também é sábado.
const FERIADO_NACIONAL = '2026-01-01T10:00:00-03:00'; // Confraternização Universal.

let contadorUuid = 0x10;
function proximoUuid(): string {
  contadorUuid += 1;
  return `cccccccc-1111-0000-0000-${contadorUuid.toString(16).padStart(12, '0')}`;
}

describe('T-089: funções SQL da cadência', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();

    const setup = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES
         ('${EMPRESA_A}', 'Empresa Teste Cadencia A', 'empresa-teste-cadencia-a'),
         ('${EMPRESA_B}', 'Empresa Teste Cadencia B', 'empresa-teste-cadencia-b');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES
         ('${LEAD_A}', '${EMPRESA_A}', 'Lead Teste A'),
         ('${LEAD_B}', '${EMPRESA_B}', 'Lead Teste B');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES
         ('${USUARIO_A}', 'sdr-a@teste.local', 'SDR Teste A'),
         ('${USUARIO_B}', 'sdr-b@teste.local', 'SDR Teste B');`
    );
    if (setup.status !== 0) {
      throw new Error(`Falha ao preparar fixtures para os testes de cadência: ${setup.stderr}`);
    }
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  function valor(sql: string): string {
    const resultado = pg.psqlComo('crm_migrator', sql);
    if (resultado.status !== 0) {
      throw new Error(`Falha ao consultar fixture: ${resultado.stderr}`);
    }
    return resultado.stdout.trim();
  }

  function valorJson<T = unknown>(sql: string): T {
    return JSON.parse(valor(sql)) as T;
  }

  function criarOportunidade(empresaId: string, leadId: string, etapaId: number): string {
    const id = proximoUuid();
    const resultado = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${id}', '${empresaId}', '${leadId}', ${etapaId})`
    );
    if (resultado.status !== 0) {
      throw new Error(`Falha ao criar oportunidade fixture: ${resultado.stderr}`);
    }
    return id;
  }

  function estadoOportunidade(id: string) {
    return valorJson<{
      etapa_id: number;
      version: number;
      cadencia_dia: number | null;
      cadencia_turno: string | null;
      cadencia_encerrada_em: string | null;
      motivo_perda_id: string | null;
    }>(
      `SELECT row_to_json(t) FROM (
         SELECT etapa_id, version, cadencia_dia, cadencia_turno, cadencia_encerrada_em, motivo_perda_id
         FROM oportunidades WHERE id = '${id}'
       ) t`
    );
  }

  interface AtividadeLinha {
    id: string;
    sequencia: number;
    dia: number;
    turno: string;
    canal: string;
    tipo: string;
    resultado: string;
    realizada_em: string | null;
    realizada_por: string | null;
  }

  function atividades(oportunidadeId: string): AtividadeLinha[] {
    return valorJson<AtividadeLinha[]>(
      `SELECT coalesce(json_agg(t), '[]'::json) FROM (
         SELECT id, sequencia, dia, turno, canal, tipo, resultado, realizada_em, realizada_por
         FROM cadencia_atividades WHERE oportunidade_id = '${oportunidadeId}' ORDER BY sequencia
       ) t`
    );
  }

  function contarEventos(oportunidadeId: string, tipo: string): number {
    return Number(
      valor(`SELECT count(*) FROM oportunidade_eventos WHERE oportunidade_id = '${oportunidadeId}' AND tipo = '${tipo}'`)
    );
  }

  function versionAtual(oportunidadeId: string): number {
    return Number(valor(`SELECT version FROM oportunidades WHERE id = '${oportunidadeId}'`));
  }

  // `psqlComo` manda `SET app.empresa_id = ...` e a consulta seguinte juntos
  // num único `-c`; psql ecoa a tag de comando "SET" antes da saída da
  // consulta, mesmo em modo `-t -A`. As duas funções abaixo (que fazem as
  // únicas chamadas que combinam `SET` com um SELECT cujo stdout é
  // parseado como dado, em vez de só checar `status`) precisam descartar
  // essa tag antes de interpretar o resto como o valor real.
  function semTagSet(stdout: string): string {
    return stdout.trim().replace(/^SET\s*/, '').trim();
  }

  function iniciarCadencia(empresaId: string, oportunidadeId: string, atorId: string) {
    const version = versionAtual(oportunidadeId);
    return pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${empresaId}';
       SELECT iniciar_cadencia('${oportunidadeId}', ${version}, '${atorId}', 'usuario', NULL)`
    );
  }

  function concluirAtividade(
    empresaId: string,
    atividadeId: string,
    oportunidadeId: string,
    resultado: 'sem_resposta' | 'conectou',
    agoraISO: string,
    atorId: string
  ) {
    const version = versionAtual(oportunidadeId);
    return pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${empresaId}';
       SELECT concluir_atividade_cadencia('${atividadeId}', ${version}, '${resultado}', '${atorId}', 'usuario', '${agoraISO}', NULL)`
    );
  }

  function virarDia(empresaId: string, agoraISO: string): Array<{ id: string; empresa_id: string }> {
    const resultado = pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${empresaId}';
       SELECT coalesce(json_agg(t), '[]'::json) FROM virar_dia_cadencia('${agoraISO}') t`
    );
    if (resultado.status !== 0) {
      throw new Error(`virar_dia_cadencia falhou: ${resultado.stderr}`);
    }
    return JSON.parse(semTagSet(resultado.stdout));
  }

  /** Conclui, em ordem de sequência, todos os toques hoje pendentes do bloco (dia, turno) com `sem_resposta`. */
  function completarBlocoSemResposta(
    empresaId: string,
    oportunidadeId: string,
    atorId: string,
    dia: number,
    turno: 'manha' | 'tarde',
    agoraISO: string
  ) {
    const pendentes = atividades(oportunidadeId)
      .filter((a) => a.dia === dia && a.turno === turno && a.resultado === 'pendente')
      .sort((a, b) => a.sequencia - b.sequencia);

    for (const toque of pendentes) {
      const resultado = concluirAtividade(empresaId, toque.id, oportunidadeId, 'sem_resposta', agoraISO, atorId);
      if (resultado.status !== 0) {
        throw new Error(`Falha ao concluir toque ${toque.sequencia} como sem_resposta: ${resultado.stderr}`);
      }
    }
  }

  describe('cadencia_bloco: paridade com a matriz pura do domínio (T-088)', () => {
    test.each([
      [1, 'manha'],
      [1, 'tarde'],
      [2, 'manha'],
      [2, 'tarde'],
      [3, 'manha'],
      [3, 'tarde'],
    ] as ReadonlyArray<readonly [Dia, Turno]>)('dia %s / turno %s: SQL replica blocoDe() exatamente', (dia, turno) => {
      const esperado = blocoDe(dia, turno);
      const obtido = valorJson(`SELECT coalesce(json_agg(t), '[]'::json) FROM cadencia_bloco(${dia}, '${turno}') t`);

      expect(obtido).toEqual(esperado);
    });
  });

  describe('AC-190: iniciar gera só o primeiro bloco', () => {
    test('card vai para 1º dia de contato (dia 1, turno manhã) com exatamente 3 toques pendentes (1-3) @spec:AC-190', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);

      const iniciar = iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A);
      expect(iniciar.status, `iniciar_cadencia deveria ter sucesso: ${iniciar.stderr}`).toBe(0);

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.etapa_id).toBe(ETAPA_1_DIA);
      expect(estado.cadencia_dia).toBe(1);
      expect(estado.cadencia_turno).toBe('manha');

      const toques = atividades(oportunidadeId);
      expect(toques).toHaveLength(3);
      expect(toques.map((t) => t.sequencia)).toEqual([1, 2, 3]);
      expect(toques.every((t) => t.resultado === 'pendente')).toBe(true);

      expect(contarEventos(oportunidadeId, 'cadencia_iniciada')).toBe(1);
    });
  });

  describe('AC-193: concluir com sem_resposta registra o fato', () => {
    test('toque fica sem_resposta, com realizada_em e realizada_por preenchidos, e grava atividade_concluida @spec:AC-193', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      const toque1 = atividades(oportunidadeId).find((t) => t.sequencia === 1)!;
      const concluir = concluirAtividade(EMPRESA_A, toque1.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A);
      expect(concluir.status, `concluir_atividade_cadencia deveria ter sucesso: ${concluir.stderr}`).toBe(0);

      const atualizado = atividades(oportunidadeId).find((t) => t.sequencia === 1)!;
      expect(atualizado.resultado).toBe('sem_resposta');
      expect(atualizado.realizada_em).not.toBeNull();
      expect(atualizado.realizada_por).toBe(USUARIO_A);

      expect(contarEventos(oportunidadeId, 'atividade_concluida')).toBe(1);
    });
  });

  describe('AC-194: terceiro sem_resposta do bloco libera o seguinte', () => {
    test('3º sem_resposta da manhã gera o bloco da tarde (sequências 4-6) do mesmo dia @spec:AC-194', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      const [t1, t2] = atividades(oportunidadeId);
      expect(concluirAtividade(EMPRESA_A, t1.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(0);
      expect(concluirAtividade(EMPRESA_A, t2.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(0);

      // ainda só 2 de 3 concluídos: nenhum bloco novo deveria ter nascido.
      expect(atividades(oportunidadeId)).toHaveLength(3);

      const t3 = atividades(oportunidadeId).find((t) => t.sequencia === 3)!;
      const terceiro = concluirAtividade(EMPRESA_A, t3.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A);
      expect(terceiro.status, `3º sem_resposta deveria ter sucesso: ${terceiro.stderr}`).toBe(0);

      const toques = atividades(oportunidadeId);
      expect(toques).toHaveLength(6);
      const tarde = toques.filter((t) => t.dia === 1 && t.turno === 'tarde');
      expect(tarde.map((t) => t.sequencia)).toEqual([4, 5, 6]);
      expect(tarde.every((t) => t.resultado === 'pendente')).toBe(true);

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.cadencia_dia).toBe(1);
      expect(estado.cadencia_turno).toBe('tarde');
      expect(estado.etapa_id).toBe(ETAPA_1_DIA);
    });

    test('bloco da tarde do dia 1 concluído não gera o bloco do dia 2 — só nasce na virada de dia (AC-199) @spec:AC-194', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'tarde', AGORA_TARDE_OK);

      const toques = atividades(oportunidadeId);
      expect(toques).toHaveLength(6);
      expect(toques.every((t) => t.resultado === 'sem_resposta')).toBe(true);

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.cadencia_dia).toBe(1);
      expect(estado.etapa_id).toBe(ETAPA_1_DIA);
    });
  });

  describe('AC-195: conectou interrompe a cadência na hora', () => {
    test('cancela as pendentes, encerra a cadência e move para Qualificando, sem gerar novos blocos @spec:AC-195', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      const [t1, t2] = atividades(oportunidadeId);
      expect(concluirAtividade(EMPRESA_A, t1.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(0);

      const conectar = concluirAtividade(EMPRESA_A, t2.id, oportunidadeId, 'conectou', AGORA_TARDE_OK, USUARIO_A);
      expect(conectar.status, `concluir com conectou deveria ter sucesso: ${conectar.stderr}`).toBe(0);

      const toques = atividades(oportunidadeId);
      expect(toques).toHaveLength(3); // nenhum bloco novo gerado
      expect(toques.find((t) => t.sequencia === 1)!.resultado).toBe('sem_resposta');
      expect(toques.find((t) => t.sequencia === 2)!.resultado).toBe('conectou');
      expect(toques.find((t) => t.sequencia === 3)!.resultado).toBe('cancelada');

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.cadencia_encerrada_em).not.toBeNull();
      expect(estado.etapa_id).toBe(ETAPA_QUALIFICANDO);

      const transicao = valor(
        `SELECT count(*) FROM oportunidade_eventos
         WHERE oportunidade_id = '${oportunidadeId}' AND tipo = 'transicao_etapa'
           AND etapa_origem_id = ${ETAPA_1_DIA} AND etapa_destino_id = ${ETAPA_QUALIFICANDO}`
      );
      expect(transicao).toBe('1');
    });
  });

  describe('AC-196: toque fora de ordem ou fora do turno é recusado', () => {
    test('toque da tarde antes das 13h é recusado com TURNO_NAO_LIBERADO e continua pendente @spec:AC-196', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);
      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'manha', AGORA_TARDE_OK);

      const tarde4 = atividades(oportunidadeId).find((t) => t.sequencia === 4)!;
      const concluir = concluirAtividade(
        EMPRESA_A,
        tarde4.id,
        oportunidadeId,
        'sem_resposta',
        AGORA_MANHA_ANTES_DAS_TARDE,
        USUARIO_A
      );
      expect(concluir.status, 'concluir antes das 13h deveria falhar').not.toBe(0);
      expect(concluir.stderr).toMatch(/TURNO_NAO_LIBERADO/);

      expect(atividades(oportunidadeId).find((t) => t.sequencia === 4)!.resultado).toBe('pendente');
    });

    test('toque de um bloco que ainda não é o corrente é recusado com BLOCO_ANTERIOR_PENDENTE @spec:AC-196', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);
      // bloco corrente ainda é (dia 1, manhã) — nenhum dos 3 toques da manhã
      // foi concluído. Insere, por fora do fluxo normal, um toque da tarde
      // (bloco que ainda não deveria existir como "corrente").
      const empresaId = valor(`SELECT empresa_id FROM oportunidades WHERE id = '${oportunidadeId}'`);
      const atividadeForaDeOrdemId = proximoUuid();
      const insercao = pg.psqlComo(
        'crm_migrator',
        `INSERT INTO cadencia_atividades (id, oportunidade_id, empresa_id, sequencia, dia, turno, canal, tipo)
         VALUES ('${atividadeForaDeOrdemId}', '${oportunidadeId}', '${empresaId}', 4, 1, 'tarde', 'telefone', 'ligacao')`
      );
      expect(insercao.status).toBe(0);

      const concluir = concluirAtividade(
        EMPRESA_A,
        atividadeForaDeOrdemId,
        oportunidadeId,
        'sem_resposta',
        AGORA_TARDE_OK,
        USUARIO_A
      );
      expect(concluir.status, 'concluir toque de bloco não liberado deveria falhar').not.toBe(0);
      expect(concluir.stderr).toMatch(/BLOCO_ANTERIOR_PENDENTE/);

      const linha = valor(`SELECT resultado FROM cadencia_atividades WHERE id = '${atividadeForaDeOrdemId}'`);
      expect(linha).toBe('pendente');
    });
  });

  describe('AC-197: toque já concluído, cancelado ou de cadência encerrada não conclui de novo', () => {
    test('concluir de novo um toque que já não está pendente é recusado com CADENCIA_ENCERRADA @spec:AC-197', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      const toque1 = atividades(oportunidadeId).find((t) => t.sequencia === 1)!;
      expect(concluirAtividade(EMPRESA_A, toque1.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(
        0
      );

      const segunda = concluirAtividade(EMPRESA_A, toque1.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A);
      expect(segunda.status, 'concluir de novo deveria falhar').not.toBe(0);
      expect(segunda.stderr).toMatch(/CADENCIA_ENCERRADA/);

      expect(atividades(oportunidadeId).find((t) => t.sequencia === 1)!.resultado).toBe('sem_resposta');
    });

    test('toque pendente de um card com cadencia_encerrada_em preenchido é recusado com CADENCIA_ENCERRADA @spec:AC-197', () => {
      // simula uma conexão por WhatsApp (fora desta feature) encerrando a
      // cadência diretamente, sem passar por concluir_atividade_cadencia —
      // os toques seguem "pendente" no banco, mas o card não aceita mais
      // conclusão alguma.
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      const encerrar = pg.psqlComo(
        'crm_migrator',
        `UPDATE oportunidades SET cadencia_encerrada_em = now() WHERE id = '${oportunidadeId}'`
      );
      expect(encerrar.status).toBe(0);

      const toque1 = atividades(oportunidadeId).find((t) => t.sequencia === 1)!;
      expect(toque1.resultado).toBe('pendente');

      const concluir = concluirAtividade(EMPRESA_A, toque1.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A);
      expect(concluir.status, 'concluir com cadência encerrada deveria falhar').not.toBe(0);
      expect(concluir.stderr).toMatch(/CADENCIA_ENCERRADA/);

      expect(atividades(oportunidadeId).find((t) => t.sequencia === 1)!.resultado).toBe('pendente');
    });
  });

  describe('AC-199: virada de dia avança só quem concluiu o dia inteiro', () => {
    test('card com os dois blocos do dia concluídos avança de etapa e dia; card com toque pendente não muda @spec:AC-199', () => {
      const avanca = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, avanca, USUARIO_A).status).toBe(0);
      completarBlocoSemResposta(EMPRESA_A, avanca, USUARIO_A, 1, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_A, avanca, USUARIO_A, 1, 'tarde', AGORA_TARDE_OK);

      const atrasado = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, atrasado, USUARIO_A).status).toBe(0);
      const [p1, p2] = atividades(atrasado);
      expect(concluirAtividade(EMPRESA_A, p1.id, atrasado, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(0);
      expect(concluirAtividade(EMPRESA_A, p2.id, atrasado, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(0);
      // sequência 3 do card "atrasado" fica pendente de propósito.

      const virada = virarDia(EMPRESA_A, DIA_UTIL);
      const idsAvancados = virada.map((o) => o.id);
      expect(idsAvancados).toContain(avanca);
      expect(idsAvancados).not.toContain(atrasado);

      const estadoAvanca = estadoOportunidade(avanca);
      expect(estadoAvanca.etapa_id).toBe(ETAPA_2_DIA);
      expect(estadoAvanca.cadencia_dia).toBe(2);
      expect(estadoAvanca.cadencia_turno).toBe('manha');
      const toquesAvanca = atividades(avanca);
      expect(toquesAvanca).toHaveLength(9);
      const manhaDia2 = toquesAvanca.filter((t) => t.dia === 2 && t.turno === 'manha');
      expect(manhaDia2.map((t) => t.sequencia)).toEqual([7, 8, 9]);
      expect(manhaDia2.every((t) => t.resultado === 'pendente')).toBe(true);
      expect(contarEventos(avanca, 'cadencia_dia_avancado')).toBe(1);

      const estadoAtrasado = estadoOportunidade(atrasado);
      expect(estadoAtrasado.etapa_id).toBe(ETAPA_1_DIA);
      expect(estadoAtrasado.cadencia_dia).toBe(1);
      expect(atividades(atrasado)).toHaveLength(3);
      expect(contarEventos(atrasado, 'cadencia_dia_avancado')).toBe(0);
    });
  });

  describe('AC-200: fim de semana e feriado não viram o dia', () => {
    test.each([
      ['sábado', SABADO],
      ['feriado nacional', FERIADO_NACIONAL],
    ])('%s: nenhum card avança, nenhum bloco é gerado @spec:AC-200', (_descricao, agoraISO) => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);
      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'tarde', AGORA_TARDE_OK);

      const estadoAntes = estadoOportunidade(oportunidadeId);
      const virada = virarDia(EMPRESA_A, agoraISO);

      expect(virada).toHaveLength(0);
      expect(estadoOportunidade(oportunidadeId)).toEqual(estadoAntes);
      expect(atividades(oportunidadeId)).toHaveLength(6);
      expect(contarEventos(oportunidadeId, 'cadencia_dia_avancado')).toBe(0);
    });
  });

  describe('AC-201: esgotar os 18 toques manda para Perdido', () => {
    test('toque 18 (breakup) concluído sem_resposta encerra a cadência e move para Perdido com motivo sistêmico @spec:AC-201', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);

      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 1, 'tarde', AGORA_TARDE_OK);
      expect(virarDia(EMPRESA_A, DIA_UTIL).map((o) => o.id)).toContain(oportunidadeId);

      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 2, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 2, 'tarde', AGORA_TARDE_OK);
      expect(virarDia(EMPRESA_A, DIA_UTIL).map((o) => o.id)).toContain(oportunidadeId);

      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 3, 'manha', AGORA_TARDE_OK);

      // bloco da tarde do dia 3 (16, 17, 18) nasceu; conclui 16 e 17 "na mão"
      // para deixar só o 18 (breakup) pendente, como o Dado do AC-201 pede.
      const [toque16, toque17] = atividades(oportunidadeId)
        .filter((t) => t.dia === 3 && t.turno === 'tarde' && t.resultado === 'pendente')
        .sort((a, b) => a.sequencia - b.sequencia);
      expect(concluirAtividade(EMPRESA_A, toque16.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(
        0
      );
      expect(concluirAtividade(EMPRESA_A, toque17.id, oportunidadeId, 'sem_resposta', AGORA_TARDE_OK, USUARIO_A).status).toBe(
        0
      );

      // toques 1-17 concluídos sem_resposta; só o 18 (breakup) segue pendente.
      const antesDoBreakup = atividades(oportunidadeId);
      expect(antesDoBreakup.filter((t) => t.resultado === 'pendente').map((t) => t.sequencia)).toEqual([18]);

      completarBlocoSemResposta(EMPRESA_A, oportunidadeId, USUARIO_A, 3, 'tarde', AGORA_TARDE_OK);

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.etapa_id).toBe(ETAPA_PERDIDO);
      expect(estado.cadencia_encerrada_em).not.toBeNull();

      const motivoId = valor(`SELECT id FROM motivos_perda WHERE nome = 'Cadência esgotada'`);
      expect(estado.motivo_perda_id).toBe(motivoId);

      const atorTipoEvento = valor(
        `SELECT ator_tipo FROM oportunidade_eventos WHERE oportunidade_id = '${oportunidadeId}' AND tipo = 'cadencia_esgotada'`
      );
      expect(atorTipoEvento).toBe('sistema');

      const payload = valorJson<{ ofertaRevisitaDisponivel: boolean }>(
        `SELECT payload FROM oportunidade_eventos WHERE oportunidade_id = '${oportunidadeId}' AND tipo = 'cadencia_esgotada'`
      );
      expect(payload.ofertaRevisitaDisponivel).toBe(true);
    });
  });

  describe('Perdido por qualquer caminho encerra a cadência (0038)', () => {
    function moverParaPerdido(oportunidadeId: string) {
      const version = versionAtual(oportunidadeId);
      const motivoId = valor(`SELECT id FROM motivos_perda WHERE nome = 'Cadência esgotada'`);
      return pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}';
         SELECT mover_oportunidade('${oportunidadeId}', ${version}, ${ETAPA_PERDIDO}, '${USUARIO_A}', 'usuario', NULL, NULL, '${motivoId}')`
      );
    }

    test('perder o card com toques pendentes preenche cadencia_encerrada_em e a virada de dia não o puxa de volta', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, oportunidadeId, USUARIO_A).status).toBe(0);
      expect(estadoOportunidade(oportunidadeId).cadencia_encerrada_em).toBeNull();

      expect(moverParaPerdido(oportunidadeId).status).toBe(0);

      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.etapa_id).toBe(ETAPA_PERDIDO);
      expect(estado.cadencia_encerrada_em).not.toBeNull();

      // Os toques pendentes ficam registrados, mas o card sai da fila/virada (tudo filtra por cadencia_encerrada_em).
      expect(virarDia(EMPRESA_A, DIA_UTIL).map((o) => o.id)).not.toContain(oportunidadeId);
      expect(estadoOportunidade(oportunidadeId).etapa_id).toBe(ETAPA_PERDIDO);
    });

    test('card perdido sem toques também fica com a cadência encerrada, e reabrir não a reabre', () => {
      const oportunidadeId = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_QUALIFICANDO);
      expect(moverParaPerdido(oportunidadeId).status).toBe(0);
      const encerradaEm = estadoOportunidade(oportunidadeId).cadencia_encerrada_em;
      expect(encerradaEm).not.toBeNull();

      const version = versionAtual(oportunidadeId);
      const reaberto = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}';
         SELECT mover_oportunidade('${oportunidadeId}', ${version}, ${ETAPA_QUALIFICANDO}, '${USUARIO_A}', 'usuario', NULL)`
      );
      expect(reaberto.status).toBe(0);
      const estado = estadoOportunidade(oportunidadeId);
      expect(estado.etapa_id).toBe(ETAPA_QUALIFICANDO);
      expect(estado.cadencia_encerrada_em).toBe(encerradaEm);
    });
  });

  describe('AC-203: cada empresa só vê e vira os próprios cards', () => {
    test('virar_dia_cadencia só avança e só retorna cards da empresa em app.empresa_id @spec:AC-203', () => {
      const cardA = criarOportunidade(EMPRESA_A, LEAD_A, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_A, cardA, USUARIO_A).status).toBe(0);
      completarBlocoSemResposta(EMPRESA_A, cardA, USUARIO_A, 1, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_A, cardA, USUARIO_A, 1, 'tarde', AGORA_TARDE_OK);

      const cardB = criarOportunidade(EMPRESA_B, LEAD_B, ETAPA_ENTRADA);
      expect(iniciarCadencia(EMPRESA_B, cardB, USUARIO_B).status).toBe(0);
      completarBlocoSemResposta(EMPRESA_B, cardB, USUARIO_B, 1, 'manha', AGORA_TARDE_OK);
      completarBlocoSemResposta(EMPRESA_B, cardB, USUARIO_B, 1, 'tarde', AGORA_TARDE_OK);

      const leituraCruzada = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA_A}'; SELECT count(*) FROM oportunidades WHERE id = '${cardB}'`
      );
      expect(semTagSet(leituraCruzada.stdout)).toBe('0');

      const viradaA = virarDia(EMPRESA_A, DIA_UTIL);
      expect(viradaA.map((o) => o.id)).toEqual([cardA]);
      expect(viradaA.every((o) => o.empresa_id === EMPRESA_A)).toBe(true);

      expect(estadoOportunidade(cardA).etapa_id).toBe(ETAPA_2_DIA);
      const estadoBAposViradaA = estadoOportunidade(cardB);
      expect(estadoBAposViradaA.etapa_id).toBe(ETAPA_1_DIA);
      expect(estadoBAposViradaA.cadencia_dia).toBe(1);
      expect(atividades(cardB)).toHaveLength(6);

      const viradaB = virarDia(EMPRESA_B, DIA_UTIL);
      expect(viradaB.map((o) => o.id)).toEqual([cardB]);
      expect(viradaB.every((o) => o.empresa_id === EMPRESA_B)).toBe(true);
      expect(estadoOportunidade(cardB).etapa_id).toBe(ETAPA_2_DIA);
    });
  });
});

// T-295 (fase2b-cadencia, US-053, AC-756/AC-757): o primeiro bloco da cadência nasce no turno em que ela é iniciada. Contra um
// Postgres 15 efêmero real: a função SQL `cadencia_primeiro_bloco` bate com a regra pura do domínio em dezenas de instantes, e o
// fluxo completo (iniciar à tarde → concluir → virar o dia) funciona como o de manhã.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { primeiroBlocoDaCadencia } from '../../src/domain/cadencia/inicio';
import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

const EMPRESA = 'cccccccc-0000-0000-0000-0000000000c1';
const LEAD = 'cccccccc-0000-0000-0000-0000000000c2';
const USUARIO = 'cccccccc-0000-0000-0000-0000000000c3';

// 2026-06-10 é quarta; 06-12 sexta; 06-13 sábado; 11-19 quinta e 11-20 sexta (feriado da Consciência Negra); 11-02 é segunda e feriado.
const INSTANTES = [
  ...[0, 3, 7, 8, 9, 11, 12, 13, 14, 17, 18, 21, 23].map((h) => `2026-06-10T${String(h).padStart(2, '0')}:30:00-03:00`),
  '2026-06-12T19:00:00-03:00', // sexta à noite → segunda
  '2026-06-13T10:00:00-03:00', // sábado
  '2026-06-14T15:00:00-03:00', // domingo à tarde
  '2026-11-19T20:00:00-03:00', // véspera de feriado → segunda (a sexta é feriado)
  '2026-11-20T14:00:00-03:00', // feriado à tarde
  '2026-11-02T09:00:00-03:00', // feriado de manhã
  '2026-06-10T13:00:00-03:00', // exatamente 13h
  '2026-06-10T12:00:00-03:00', // exatamente 12h
  '2026-06-10T18:00:00-03:00', // exatamente 18h
  '2026-06-10T08:00:00-03:00', // exatamente 8h
];

describe('T-295: primeiro bloco da cadência no turno do início', () => {
  let pg: PostgresEfemero;
  let contador = 0x100;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
    const r = pg.psqlComo(
      'crm_migrator',
      `INSERT INTO "empresas" ("id", "nome", "slug") VALUES ('${EMPRESA}', 'Empresa Inicio', 'empresa-inicio');
       INSERT INTO "leads" ("id", "empresa_id", "nome") VALUES ('${LEAD}', '${EMPRESA}', 'Lead Inicio');
       INSERT INTO "usuarios" ("id", "email", "nome") VALUES ('${USUARIO}', 'sdr-inicio@teste.local', 'SDR Inicio');`
    );
    if (r.status !== 0) throw new Error(r.stderr);
  }, 120_000);
  afterAll(() => pg?.parar());

  const valor = (sql: string) => {
    const r = pg.psqlComo('crm_migrator', sql);
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  const semTagSet = (s: string) => s.trim().replace(/^SET\s*/, '').trim();

  function novoCard(): string {
    contador += 1;
    const id = `cccccccc-2222-0000-0000-${contador.toString(16).padStart(12, '0')}`;
    valor(`INSERT INTO "oportunidades" ("id", "empresa_id", "lead_id", "etapa_id") VALUES ('${id}', '${EMPRESA}', '${LEAD}', 1)`);
    return id;
  }
  function iniciar(card: string, agoraISO: string | null) {
    const version = Number(valor(`SELECT version FROM oportunidades WHERE id = '${card}'`));
    const r = pg.psqlComo(
      'crm_app',
      `SET app.empresa_id = '${EMPRESA}'; SELECT iniciar_cadencia('${card}', ${version}, '${USUARIO}', 'usuario', NULL${agoraISO ? `, '${agoraISO}'` : ''})`
    );
    if (r.status !== 0) throw new Error(r.stderr);
  }
  function toques(card: string) {
    return JSON.parse(
      valor(`SELECT coalesce(json_agg(t), '[]'::json) FROM (SELECT id, sequencia, dia, turno, canal, tipo, resultado,
              to_char(liberada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS liberada_em
              FROM cadencia_atividades WHERE oportunidade_id = '${card}' ORDER BY sequencia) t`)
    ) as Array<{ id: string; sequencia: number; dia: number; turno: string; canal: string; tipo: string; resultado: string; liberada_em: string }>;
  }
  const ponteiro = (card: string) => valor(`SELECT cadencia_dia || '/' || cadencia_turno FROM oportunidades WHERE id = '${card}'`);

  test('a função SQL e a regra do domínio dão o mesmo turno e a mesma hora de liberação em todos os instantes @spec:AC-756', () => {
    for (const instante of INSTANTES) {
      const esperado = primeiroBlocoDaCadencia(new Date(instante));
      const obtido = JSON.parse(
        valor(`SELECT row_to_json(t) FROM (SELECT turno, to_char(liberada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS liberada_em FROM cadencia_primeiro_bloco('${instante}')) t`)
      );
      expect(obtido, instante).toEqual({ turno: esperado.turno, liberada_em: esperado.liberadaEm.toISOString() });
    }
  });

  test('o domínio escolhe o turno e a hora certos: manhã, almoço, tarde, noite e fim de semana @spec:AC-756', () => {
    const bloco = (iso: string) => {
      const r = primeiroBlocoDaCadencia(new Date(iso));
      return `${r.turno} ${r.liberadaEm.toISOString()}`;
    };
    expect(bloco('2026-06-10T09:30:00-03:00')).toBe('manha 2026-06-10T12:30:00.000Z'); // agora
    expect(bloco('2026-06-10T07:00:00-03:00')).toBe('manha 2026-06-10T11:00:00.000Z'); // hoje às 8h
    expect(bloco('2026-06-10T12:20:00-03:00')).toBe('tarde 2026-06-10T16:00:00.000Z'); // hoje às 13h
    expect(bloco('2026-06-10T14:00:00-03:00')).toBe('tarde 2026-06-10T17:00:00.000Z'); // agora
    expect(bloco('2026-06-10T18:00:00-03:00')).toBe('manha 2026-06-11T11:00:00.000Z'); // amanhã às 8h
    expect(bloco('2026-06-12T19:00:00-03:00')).toBe('manha 2026-06-15T11:00:00.000Z'); // segunda às 8h
    expect(bloco('2026-06-13T10:00:00-03:00')).toBe('manha 2026-06-15T11:00:00.000Z');
    expect(bloco('2026-11-19T20:00:00-03:00')).toBe('manha 2026-11-23T11:00:00.000Z'); // sexta é feriado → segunda
  });

  test('iniciada à tarde, o primeiro bloco é o da tarde (toques 4 a 6), com o card apontando para ele @spec:AC-756', () => {
    const card = novoCard();
    iniciar(card, '2026-06-10T14:00:00-03:00');

    const t = toques(card);
    expect(t.map((x) => [x.sequencia, x.dia, x.turno, x.canal, x.tipo, x.resultado])).toEqual([
      [4, 1, 'tarde', 'telefone', 'ligacao', 'pendente'],
      [5, 1, 'tarde', 'telefone', 'ligacao', 'pendente'],
      [6, 1, 'tarde', 'whatsapp', 'mensagem', 'pendente'],
    ]);
    expect(new Set(t.map((x) => x.liberada_em))).toEqual(new Set(['2026-06-10T17:00:00Z']));
    expect(ponteiro(card)).toBe('1/tarde');
    expect(valor(`SELECT etapa_id FROM oportunidades WHERE id = '${card}'`)).toBe('2');
  });

  test('iniciada de manhã, ou sem relógio, o primeiro bloco continua sendo o da manhã (toques 1 a 3) @spec:AC-756', () => {
    const deManha = novoCard();
    iniciar(deManha, '2026-06-10T09:00:00-03:00');
    expect(toques(deManha).map((x) => [x.sequencia, x.turno])).toEqual([[1, 'manha'], [2, 'manha'], [3, 'manha']]);
    expect(ponteiro(deManha)).toBe('1/manha');

    const semRelogio = novoCard();
    iniciar(semRelogio, null);
    expect(toques(semRelogio).map((x) => [x.sequencia, x.turno])).toEqual([[1, 'manha'], [2, 'manha'], [3, 'manha']]);
  });

  test('iniciada à noite ou no fim de semana, o bloco da manhã nasce liberado para o próximo dia útil @spec:AC-757', () => {
    const sexta = novoCard();
    iniciar(sexta, '2026-06-12T19:00:00-03:00');
    expect(new Set(toques(sexta).map((x) => x.liberada_em))).toEqual(new Set(['2026-06-15T11:00:00Z']));
    expect(toques(sexta).every((x) => x.turno === 'manha' && x.sequencia <= 3)).toBe(true);

    const almoco = novoCard();
    iniciar(almoco, '2026-06-10T12:20:00-03:00');
    expect(new Set(toques(almoco).map((x) => `${x.turno} ${x.liberada_em}`))).toEqual(new Set(['tarde 2026-06-10T16:00:00Z']));
  });

  test('o fluxo da tarde fecha o dia sem gerar nada e a virada de dia gera a manhã do dia 2 (toques 7 a 9) @spec:AC-756', () => {
    const card = novoCard();
    iniciar(card, '2026-06-10T14:00:00-03:00');

    const concluir = (atividade: string, agoraISO: string) => {
      const version = Number(valor(`SELECT version FROM oportunidades WHERE id = '${card}'`));
      const r = pg.psqlComo(
        'crm_app',
        `SET app.empresa_id = '${EMPRESA}'; SELECT concluir_atividade_cadencia('${atividade}', ${version}, 'sem_resposta', '${USUARIO}', 'usuario', '${agoraISO}', NULL)`
      );
      if (r.status !== 0) throw new Error(r.stderr);
    };
    for (const t of toques(card)) concluir(t.id, '2026-06-10T15:00:00-03:00');
    expect(toques(card).map((x) => x.resultado)).toEqual(['sem_resposta', 'sem_resposta', 'sem_resposta']);

    const virou = pg.psqlComo('crm_app', `SET app.empresa_id = '${EMPRESA}'; SELECT count(*) FROM virar_dia_cadencia('2026-06-11T00:05:00-03:00') t`);
    expect(virou.status).toBe(0);
    expect(semTagSet(virou.stdout)).toBe('1');
    expect(toques(card).map((x) => [x.sequencia, x.dia, x.turno])).toEqual([
      [4, 1, 'tarde'],
      [5, 1, 'tarde'],
      [6, 1, 'tarde'],
      [7, 2, 'manha'],
      [8, 2, 'manha'],
      [9, 2, 'manha'],
    ]);
    expect(ponteiro(card)).toBe('2/manha');
  });
});

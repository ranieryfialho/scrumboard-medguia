// Testes de T-025 (fase1-schema-drizzle, US-012): prova, contra um Postgres
// 15 efêmero real (harness de T-020) com a migration de seeds (T-019)
// aplicada, que as 15 etapas do pipeline (AC-029), o grafo de transições
// permitido (AC-030) e os motivos de perda mínimos (AC-031) nascem exatamente
// como o TDD-001 §4.4 e o RFC-001 §6 descrevem — sem precisar digitar nada à
// mão em ambiente nenhum (CI, staging, produção).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { subirPostgresEfemero, type PostgresEfemero } from '../support/postgres-efemero';

// Espelha, coluna a coluna e na ordem, o INSERT de `pipeline_etapas` em
// drizzle/0005_seeds.sql.
const ETAPAS_ESPERADAS = [
  [1, 1, 'Entrada de leads', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [2, 2, '1º dia de contato', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [3, 3, '2º dia de contato', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [4, 4, '3º dia de contato', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [5, 5, 'Qualificando', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [6, 6, 'Qualificado p/ reunião', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [7, 7, 'Follow de longo prazo', 'SDR', 'f', 'f', 't', 'f', 'f'],
  [8, 8, 'Reunião agendada', 'SDR', 'f', 'f', 'f', 'f', 'f'],
  [9, 9, 'No-show', 'CLOSER', 'f', 'f', 'f', 'f', 'f'],
  [10, 10, 'Reunião realizada', 'CLOSER', 'f', 'f', 'f', 't', 'f'],
  [11, 11, 'Proposta', 'CLOSER', 't', 'f', 't', 'f', 'f'],
  [12, 12, 'Teste (Trial)', 'CLOSER', 'f', 'f', 't', 'f', 'f'],
  [13, 13, 'Negociação', 'CLOSER', 'f', 'f', 't', 'f', 'f'],
  [14, 14, 'Perdido', 'CLOSER', 'f', 't', 'f', 'f', 't'],
  [15, 15, 'Contrato (Ganho)', 'CLOSER', 'f', 'f', 'f', 'f', 't'],
].map((linha) => linha.join('|'));

// Espelha, um par por linha e na ordem crescente (origem, destino), o INSERT
// de `pipeline_transicoes` em drizzle/0005_seeds.sql — exatamente as
// combinações do TDD-001 §4.4 + saltos do RFC-001 §6 item 7, nenhuma outra.
const TRANSICOES_ESPERADAS = [
  [1, 2],
  [1, 14],
  [2, 3],
  [2, 5],
  [2, 14],
  [3, 4],
  [3, 5],
  [3, 14],
  [4, 5],
  [4, 14],
  [5, 6],
  [5, 7],
  [5, 14],
  [6, 8],
  [6, 14],
  [7, 2],
  [7, 14],
  [8, 9],
  [8, 6],
  [8, 10],
  [8, 14],
  [9, 8],
  [9, 14],
  [10, 11],
  [10, 14],
  [11, 12],
  [11, 13],
  [11, 15],
  [11, 14],
  [12, 13],
  [12, 15],
  [12, 14],
  [13, 15],
  [13, 14],
  [14, 5],
  [15, 13],
  [15, 14],
]
  .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  .map(([origem, destino]) => `${origem}|${destino}`);

describe('T-025: seeds idempotentes do pipeline', () => {
  let pg: PostgresEfemero;

  beforeAll(async () => {
    pg = await subirPostgresEfemero();
    pg.aplicarMigrations();
  }, 120_000);

  afterAll(() => {
    pg?.parar();
  });

  describe('AC-029: as 15 etapas existem após a migration, na ordem certa', () => {
    test('pipeline_etapas tem as 15 etapas do TDD-001 §4.4, com macrofluxo e flags corretos @spec:AC-029', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT "id", "ordem", "nome", "macrofluxo", "exige_valor", "exige_motivo", "exige_proxima_acao", "exige_evidencia", "e_terminal"
         FROM "pipeline_etapas" ORDER BY "ordem"`
      );
      expect(resultado.status).toBe(0);
      expect(resultado.stdout.trim().split('\n')).toEqual(ETAPAS_ESPERADAS);
    });
  });

  describe('AC-030: o grafo de transições permitido existe e bloqueia o resto por omissão', () => {
    test('pipeline_transicoes tem exatamente as combinações do TDD-001 §4.4 + saltos do RFC-001 §6, nenhuma outra @spec:AC-030', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT "etapa_origem_id", "etapa_destino_id" FROM "pipeline_transicoes" ORDER BY "etapa_origem_id", "etapa_destino_id"`
      );
      expect(resultado.status).toBe(0);
      expect(resultado.stdout.trim().split('\n')).toEqual(TRANSICOES_ESPERADAS);
    });

    test('toda transição tem ao menos um papel permitido @spec:AC-030', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT count(*) FROM "pipeline_transicoes" WHERE "papeis_permitidos" IS NULL OR array_length("papeis_permitidos", 1) IS NULL`
      );
      expect(resultado.status).toBe(0);
      expect(resultado.stdout.trim()).toBe('0');
    });
  });

  describe('AC-031: seeds de motivos_perda cobrem os motivos já exigidos pelo mapeamento de migração', () => {
    // Lista validada por @Raniery (Driver) em 24/09/2026 (Q-004 da spec) —
    // os 4 motivos mínimos do RFC-001 §6 item 8 mais os motivos de perda
    // mais comuns de uma venda B2B (preço, concorrência, timing, decisor).
    test('os 8 motivos validados existem, com "Cadência esgotada" sistêmico e "Legado — arquivado" inativo @spec:AC-031', () => {
      const resultado = pg.psqlComo(
        'crm_migrator',
        `SELECT "nome", "ativo", "e_sistemico" FROM "motivos_perda" ORDER BY "nome"`
      );
      expect(resultado.status).toBe(0);

      const linhas = new Map(
        resultado.stdout
          .trim()
          .split('\n')
          .map((linha) => {
            const [nome, ativo, eSistemico] = linha.split('|');
            return [nome, { ativo, eSistemico }];
          })
      );

      expect(linhas.get('Sem interesse')).toEqual({ ativo: 't', eSistemico: 'f' });
      expect(linhas.get('Sem perfil/fit')).toEqual({ ativo: 't', eSistemico: 'f' });
      expect(linhas.get('Preço/orçamento')).toEqual({ ativo: 't', eSistemico: 'f' });
      expect(linhas.get('Escolheu concorrente')).toEqual({ ativo: 't', eSistemico: 'f' });
      expect(linhas.get('Não é o momento')).toEqual({ ativo: 't', eSistemico: 'f' });
      expect(linhas.get('Decisor não disponível/trocou')).toEqual({ ativo: 't', eSistemico: 'f' });
      expect(linhas.get('Cadência esgotada')).toEqual({ ativo: 't', eSistemico: 't' });
      // Bucket só de migração (RFC-001 §6) — inativo, não deve aparecer como
      // opção escolhível pelo time comercial daqui pra frente.
      expect(linhas.get('Legado — arquivado')).toEqual({ ativo: 'f', eSistemico: 'f' });
      expect(linhas.size, 'não deveria existir motivo além dos 8 validados').toBe(8);
    });
  });
});

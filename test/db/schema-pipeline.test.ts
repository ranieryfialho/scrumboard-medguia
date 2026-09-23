// Testes de T-012 (fase1-schema-drizzle, US-007/US-008): tabelas do pipeline.
// Introspecção estática do schema Drizzle (sem Postgres) — a prova de que as
// migrations aplicam o schema completo num banco limpo é do T-021 (AC-015).
import { describe, test, expect } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';

import {
  pipelineEtapas,
  pipelineTransicoes,
  motivosPerda,
  leads,
  oportunidades,
  cadenciaAtividades,
  oportunidadeEventos,
  tarefasAgendadas,
  anexos,
  reunioes,
} from '../../src/db/schema';

describe('T-012: configuração do pipeline (@spec:AC-015)', () => {
  test('pipeline_etapas existe com as flags de guard da etapa', () => {
    expect(getTableName(pipelineEtapas)).toBe('pipeline_etapas');
    const columns = getTableColumns(pipelineEtapas);
    expect(columns.id.primary).toBe(true);
    expect(columns.ordem.notNull).toBe(true);
    expect(columns.nome.notNull).toBe(true);
    expect(columns.macrofluxo.notNull).toBe(true);
    expect(columns.exigeValor.notNull).toBe(true);
    expect(columns.exigeMotivo.notNull).toBe(true);
    expect(columns.exigeProximaAcao.notNull).toBe(true);
    expect(columns.exigeEvidencia.notNull).toBe(true);
    expect(columns.eTerminal.notNull).toBe(true);
  });

  test('pipeline_transicoes existe com origem, destino e papéis permitidos', () => {
    expect(getTableName(pipelineTransicoes)).toBe('pipeline_transicoes');
    const columns = getTableColumns(pipelineTransicoes);
    expect(columns.etapaOrigemId.notNull).toBe(true);
    expect(columns.etapaDestinoId.notNull).toBe(true);
    expect(columns.exigeJustificativa.notNull).toBe(true);
    expect(columns.papeisPermitidos.notNull).toBe(true);
  });

  test('motivos_perda existe com nome e flag de motivo sistêmico', () => {
    expect(getTableName(motivosPerda)).toBe('motivos_perda');
    const columns = getTableColumns(motivosPerda);
    expect(columns.nome.notNull).toBe(true);
    expect(columns.ativo.notNull).toBe(true);
    expect(columns.eSistemico.notNull).toBe(true);
  });
});

describe('T-012: tabelas de negócio do pipeline exigem tenant (@spec:AC-018)', () => {
  test('leads exige empresa_id', () => {
    expect(getTableName(leads)).toBe('leads');
    const columns = getTableColumns(leads);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.nome.notNull).toBe(true);
  });

  test('oportunidades exige empresa_id e carrega version para lock otimista', () => {
    expect(getTableName(oportunidades)).toBe('oportunidades');
    const columns = getTableColumns(oportunidades);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.leadId.notNull).toBe(true);
    expect(columns.etapaId.notNull).toBe(true);
    expect(columns.version.notNull).toBe(true);
  });

  test('cadencia_atividades exige empresa_id e oportunidade_id', () => {
    expect(getTableName(cadenciaAtividades)).toBe('cadencia_atividades');
    const columns = getTableColumns(cadenciaAtividades);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.oportunidadeId.notNull).toBe(true);
    expect(columns.sequencia.notNull).toBe(true);
    expect(columns.dia.notNull).toBe(true);
  });

  test('oportunidade_eventos exige empresa_id (log append-only)', () => {
    expect(getTableName(oportunidadeEventos)).toBe('oportunidade_eventos');
    const columns = getTableColumns(oportunidadeEventos);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.oportunidadeId.notNull).toBe(true);
    expect(columns.atorTipo.notNull).toBe(true);
  });

  test('tarefas_agendadas exige empresa_id', () => {
    expect(getTableName(tarefasAgendadas)).toBe('tarefas_agendadas');
    const columns = getTableColumns(tarefasAgendadas);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.agendadaPara.notNull).toBe(true);
  });

  test('anexos exige empresa_id', () => {
    expect(getTableName(anexos)).toBe('anexos');
    const columns = getTableColumns(anexos);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.caminho.notNull).toBe(true);
  });

  test('reunioes exige empresa_id', () => {
    expect(getTableName(reunioes)).toBe('reunioes');
    const columns = getTableColumns(reunioes);
    expect(columns.empresaId.notNull).toBe(true);
    expect(columns.agendadaPara.notNull).toBe(true);
  });
});

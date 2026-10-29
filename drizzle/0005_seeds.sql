-- T-019: seeds idempotentes do pipeline (AC-029, AC-030, AC-031).
--
-- `pipeline_etapas` e `pipeline_transicoes` são as 15 etapas e o grafo de
-- transições do TDD-001 §4.4 (mesma numeração usada como ID literal nos
-- CHECKs da migration 0002 — mudar uma etapa é migration nova, nunca edição
-- de linha, por isso ON CONFLICT ... DO NOTHING). O grafo bloqueia por
-- omissão: nenhuma policy permissiva, só as combinações inseridas aqui
-- existem (AC-030).
--
-- `motivos_perda` não é enum fechado (a lista final depende de
-- @Alana/@Erivelton, TDD-001 §17 pergunta 2) — o ON CONFLICT é por `nome`
-- para permitir crescer sem duplicar (AC-031).
--
-- Reaplicar esta migration não duplica nada (AC-017): todo INSERT tem
-- ON CONFLICT DO NOTHING contra a constraint/índice único correspondente.

INSERT INTO "pipeline_etapas"
  ("id", "ordem", "nome", "macrofluxo", "exige_valor", "exige_motivo", "exige_proxima_acao", "exige_evidencia", "e_terminal")
VALUES
  (1, 1, 'Entrada de leads', 'SDR', false, false, false, false, false),
  (2, 2, '1º dia de contato', 'SDR', false, false, false, false, false),
  (3, 3, '2º dia de contato', 'SDR', false, false, false, false, false),
  (4, 4, '3º dia de contato', 'SDR', false, false, false, false, false),
  (5, 5, 'Qualificando', 'SDR', false, false, false, false, false),
  (6, 6, 'Qualificado p/ reunião', 'SDR', false, false, false, false, false),
  (7, 7, 'Follow de longo prazo', 'SDR', false, false, true, false, false),
  (8, 8, 'Reunião agendada', 'SDR', false, false, false, false, false),
  (9, 9, 'No-show', 'CLOSER', false, false, false, false, false),
  (10, 10, 'Reunião realizada', 'CLOSER', false, false, false, true, false),
  (11, 11, 'Proposta', 'CLOSER', true, false, true, false, false),
  (12, 12, 'Teste (Trial)', 'CLOSER', false, false, true, false, false),
  (13, 13, 'Negociação', 'CLOSER', false, false, true, false, false),
  (14, 14, 'Perdido', 'CLOSER', false, true, false, false, true),
  (15, 15, 'Contrato (Ganho)', 'CLOSER', false, false, false, false, true)
ON CONFLICT ("id") DO NOTHING;

-- Grafo de transições (TDD-001 §4.4 + saltos do RFC-001 §6 item 7):
-- sequência linear da cadência, conexão imediata, remarcação de no-show,
-- Proposta→Negociação sem Teste, Proposta/Teste→Contrato, Follow→1º dia,
-- reaberturas com justificativa (Perdido→Qualificando, Ganho→Negociação) e
-- "qualquer etapa→Perdido" (uma linha por etapa de origem, exceto a própria
-- Perdido).
INSERT INTO "pipeline_transicoes"
  ("etapa_origem_id", "etapa_destino_id", "exige_justificativa", "papeis_permitidos")
VALUES
  -- sequência linear da cadência e qualificação
  (1, 2, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (2, 3, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (3, 4, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (2, 5, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (3, 5, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (4, 5, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (5, 6, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (5, 7, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (7, 2, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (6, 8, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (8, 9, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (9, 8, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (8, 10, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (10, 11, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (11, 12, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (11, 13, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (11, 15, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (12, 13, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (12, 15, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (13, 15, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  -- reaberturas com justificativa obrigatória (RFC-001 §6 item 7, Q9)
  (14, 5, true, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (15, 13, true, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  -- qualquer etapa → Perdido (com motivo; motivo em si é o CHECK da 0002)
  (1, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (2, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (3, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (4, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (5, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (6, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (7, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (8, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (9, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (10, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (11, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (12, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (13, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[]),
  (15, 14, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[])
ON CONFLICT ("etapa_origem_id", "etapa_destino_id") DO NOTHING;

-- Motivos de perda (TDD-001 §17 pergunta 2, Q-004 da spec desta feature):
-- lista validada por @Raniery (Driver) em 24/09/2026, cobrindo os motivos
-- mínimos exigidos pelo mapeamento de migração do RFC-001 §6 item 8 mais os
-- motivos de perda mais comuns de uma venda B2B (preço, concorrência,
-- timing, troca de decisor) — ainda lista aberta, não é enum fechado,
-- ON CONFLICT por nome permite crescer sem quebrar nada.
--
-- "Legado — arquivado" nasce com `ativo = false`: existe só para mapear
-- cards antigos já perdidos no cutover (RFC-001 §6), não deve aparecer como
-- opção escolhível pelo time comercial daqui pra frente.
INSERT INTO "motivos_perda" ("nome", "ativo", "e_sistemico")
VALUES
  ('Sem interesse', true, false),
  ('Sem perfil/fit', true, false),
  ('Preço/orçamento', true, false),
  ('Escolheu concorrente', true, false),
  ('Não é o momento', true, false),
  ('Decisor não disponível/trocou', true, false),
  ('Cadência esgotada', true, true),
  ('Legado — arquivado', false, false)
-- fase5-motivos-por-empresa (migration 0019): o índice único de `nome` virou dois índices parciais
-- (globais e por empresa); sem alvo, o `DO NOTHING` vale para qualquer um deles e o seed segue
-- reaplicável (AC-017). Antes: ON CONFLICT ("nome") DO NOTHING.
ON CONFLICT DO NOTHING;

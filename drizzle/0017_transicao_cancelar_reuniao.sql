-- T-229 (fase5-acoes-rapidas, US-150, AC-644/ASM-224): cancelar uma reunião devolve o card de
-- "Reunião agendada" (8) para "Qualificado p/ reunião" (6). É só dado: uma linha nova no grafo de
-- transições, para os três papéis e sem justificativa. Idempotente.
INSERT INTO "pipeline_transicoes" ("etapa_origem_id", "etapa_destino_id", "exige_justificativa", "papeis_permitidos")
VALUES (8, 6, false, ARRAY['MASTER','GERENTE','ATENDENTE']::papel_usuario[])
ON CONFLICT ("etapa_origem_id", "etapa_destino_id") DO NOTHING;

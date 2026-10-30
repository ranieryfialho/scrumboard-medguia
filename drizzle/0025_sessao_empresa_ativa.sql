-- T-280 (fase1-auth-rbac, US-019, AC-728): a empresa em que o super admin está atuando, guardada na própria sessão.
-- Até aqui ela vivia num mapa na memória do processo, que só o /api/me consultava: o seletor de empresa mudava o nome no topo,
-- mas os dados (cards, campanhas, equipe...) continuavam os da primeira empresa do usuário. Nula = vale o vínculo normal.

ALTER TABLE "sessoes" ADD COLUMN "empresa_ativa_id" uuid;
--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_empresa_ativa_id_empresas_id_fk" FOREIGN KEY ("empresa_ativa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;

DO $$ BEGIN
 CREATE TYPE "public"."papel_usuario" AS ENUM('MASTER', 'GERENTE', 'ATENDENTE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."ator_tipo" AS ENUM('usuario', 'sistema', 'migracao');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cadencia_canal" AS ENUM('telefone', 'whatsapp');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cadencia_resultado" AS ENUM('pendente', 'sem_resposta', 'conectou', 'cancelada');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cadencia_tipo" AS ENUM('ligacao', 'mensagem', 'breakup');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cadencia_turno" AS ENUM('manha', 'tarde');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."macrofluxo" AS ENUM('SDR', 'CLOSER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."cron_status" AS ENUM('em_execucao', 'sucesso', 'falha');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."whatsapp_direcao" AS ENUM('enviada', 'recebida');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "empresa_configuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"valor" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "empresas_usuarios" (
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"papel" "papel_usuario" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_usuarios_empresa_id_usuario_id_pk" PRIMARY KEY("empresa_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"id_conta" text NOT NULL,
	"id_provedor" text NOT NULL,
	"token_acesso" text,
	"token_refresh" text,
	"token_id" text,
	"token_acesso_expira_em" timestamp with time zone,
	"token_refresh_expira_em" timestamp with time zone,
	"escopo" text,
	"senha" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"endereco_ip" text,
	"user_agent" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tokens_verificacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identificador" text NOT NULL,
	"valor" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anexos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"oportunidade_id" uuid NOT NULL,
	"caminho" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"hash" text NOT NULL,
	"enviado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cadencia_atividades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oportunidade_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"sequencia" integer NOT NULL,
	"dia" integer NOT NULL,
	"turno" "cadencia_turno" NOT NULL,
	"canal" "cadencia_canal" NOT NULL,
	"tipo" "cadencia_tipo" NOT NULL,
	"resultado" "cadencia_resultado" DEFAULT 'pendente' NOT NULL,
	"realizada_em" timestamp with time zone,
	"realizada_por" uuid,
	"observacao" text,
	"anexo_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"telefone_e164" text,
	"email" text,
	"origem" text,
	"id_externo" text,
	"dados" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "motivos_perda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"e_sistemico" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oportunidade_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"oportunidade_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"etapa_origem_id" integer,
	"etapa_destino_id" integer,
	"ator_id" uuid,
	"ator_tipo" "ator_tipo" NOT NULL,
	"payload" jsonb,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oportunidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"etapa_id" integer NOT NULL,
	"responsavel_id" uuid,
	"valor" numeric(12, 2),
	"motivo_perda_id" uuid,
	"proxima_acao_em" timestamp with time zone,
	"cadencia_dia" integer,
	"cadencia_turno" "cadencia_turno",
	"cadencia_encerrada_em" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_etapas" (
	"id" integer PRIMARY KEY NOT NULL,
	"ordem" integer NOT NULL,
	"nome" text NOT NULL,
	"macrofluxo" "macrofluxo" NOT NULL,
	"exige_valor" boolean DEFAULT false NOT NULL,
	"exige_motivo" boolean DEFAULT false NOT NULL,
	"exige_proxima_acao" boolean DEFAULT false NOT NULL,
	"exige_evidencia" boolean DEFAULT false NOT NULL,
	"e_terminal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_transicoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"etapa_origem_id" integer NOT NULL,
	"etapa_destino_id" integer NOT NULL,
	"exige_justificativa" boolean DEFAULT false NOT NULL,
	"papeis_permitidos" "papel_usuario"[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reunioes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oportunidade_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"agendada_para" timestamp with time zone NOT NULL,
	"calendar_event_id" text,
	"iniciada_em" timestamp with time zone,
	"encerrada_em" timestamp with time zone,
	"duracao_minutos" integer,
	"resumo" text,
	"anexo_id" uuid,
	"no_show" boolean DEFAULT false NOT NULL,
	"remarcada_de" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tarefas_agendadas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"oportunidade_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"agendada_para" timestamp with time zone NOT NULL,
	"concluida_em" timestamp with time zone,
	"responsavel_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cron_execucoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	"status" "cron_status" DEFAULT 'em_execucao' NOT NULL,
	"itens_processados" integer DEFAULT 0 NOT NULL,
	"erro" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origem" text NOT NULL,
	"janela_inicio" timestamp with time zone,
	"janela_fim" timestamp with time zone,
	"linhas_lidas" integer DEFAULT 0 NOT NULL,
	"linhas_criadas" integer DEFAULT 0 NOT NULL,
	"linhas_ignoradas" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "migracao_registros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origem" text NOT NULL,
	"id_externo" text NOT NULL,
	"entidade" text NOT NULL,
	"id_destino" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campanhas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"assunto" text NOT NULL,
	"corpo_html" text NOT NULL,
	"status" text DEFAULT 'RASCUNHO' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "envios_campanha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"campanha_id" uuid NOT NULL,
	"nome_destinatario" text NOT NULL,
	"email_destinatario" text NOT NULL,
	"status" text DEFAULT 'RASCUNHO' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"enviado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"lead_id" uuid,
	"numero" text NOT NULL,
	"mensagem" text NOT NULL,
	"direcao" "whatsapp_direcao" NOT NULL,
	"status" text DEFAULT 'entregue' NOT NULL,
	"evolution_message_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "empresa_configuracoes" ADD CONSTRAINT "empresa_configuracoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "empresas_usuarios" ADD CONSTRAINT "empresas_usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "empresas_usuarios" ADD CONSTRAINT "empresas_usuarios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contas" ADD CONSTRAINT "contas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "anexos" ADD CONSTRAINT "anexos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "anexos" ADD CONSTRAINT "anexos_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "anexos" ADD CONSTRAINT "anexos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_realizada_por_usuarios_id_fk" FOREIGN KEY ("realizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_anexo_id_anexos_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."anexos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_etapa_origem_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_origem_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_etapa_destino_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_destino_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_ator_id_usuarios_id_fk" FOREIGN KEY ("ator_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_etapa_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_motivo_perda_id_motivos_perda_id_fk" FOREIGN KEY ("motivo_perda_id") REFERENCES "public"."motivos_perda"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_transicoes" ADD CONSTRAINT "pipeline_transicoes_etapa_origem_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_origem_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_transicoes" ADD CONSTRAINT "pipeline_transicoes_etapa_destino_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_destino_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reunioes" ADD CONSTRAINT "reunioes_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reunioes" ADD CONSTRAINT "reunioes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reunioes" ADD CONSTRAINT "reunioes_anexo_id_anexos_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."anexos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tarefas_agendadas" ADD CONSTRAINT "tarefas_agendadas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tarefas_agendadas" ADD CONSTRAINT "tarefas_agendadas_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tarefas_agendadas" ADD CONSTRAINT "tarefas_agendadas_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "envios_campanha" ADD CONSTRAINT "envios_campanha_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "envios_campanha" ADD CONSTRAINT "envios_campanha_campanha_id_campanhas_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campanhas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_configuracoes_empresa_chave_unica" ON "empresa_configuracoes" USING btree ("empresa_id","chave");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "empresas_slug_unico" ON "empresas" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_email_unico" ON "usuarios" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessoes_token_unico" ON "sessoes" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cadencia_atividades_oportunidade_sequencia_unica" ON "cadencia_atividades" USING btree ("oportunidade_id","sequencia");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "motivos_perda_nome_unico" ON "motivos_perda" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_transicoes_origem_destino_unica" ON "pipeline_transicoes" USING btree ("etapa_origem_id","etapa_destino_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "migracao_registros_origem_id_externo_unica" ON "migracao_registros" USING btree ("origem","id_externo");
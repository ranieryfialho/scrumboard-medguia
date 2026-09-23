CREATE TYPE "public"."papel_usuario" AS ENUM('MASTER', 'GERENTE', 'ATENDENTE');--> statement-breakpoint
CREATE TYPE "public"."ator_tipo" AS ENUM('usuario', 'sistema', 'migracao');--> statement-breakpoint
CREATE TYPE "public"."cadencia_canal" AS ENUM('telefone', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."cadencia_resultado" AS ENUM('pendente', 'sem_resposta', 'conectou', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."cadencia_tipo" AS ENUM('ligacao', 'mensagem', 'breakup');--> statement-breakpoint
CREATE TYPE "public"."cadencia_turno" AS ENUM('manha', 'tarde');--> statement-breakpoint
CREATE TYPE "public"."macrofluxo" AS ENUM('SDR', 'CLOSER');--> statement-breakpoint
CREATE TYPE "public"."cron_status" AS ENUM('em_execucao', 'sucesso', 'falha');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_direcao" AS ENUM('enviada', 'recebida');--> statement-breakpoint
CREATE TABLE "empresa_configuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"valor" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresas_usuarios" (
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"papel" "papel_usuario" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_usuarios_empresa_id_usuario_id_pk" PRIMARY KEY("empresa_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contas" (
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
CREATE TABLE "sessoes" (
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
CREATE TABLE "tokens_verificacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identificador" text NOT NULL,
	"valor" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anexos" (
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
CREATE TABLE "cadencia_atividades" (
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
CREATE TABLE "leads" (
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
CREATE TABLE "motivos_perda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"e_sistemico" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oportunidade_eventos" (
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
CREATE TABLE "oportunidades" (
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
CREATE TABLE "pipeline_etapas" (
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
CREATE TABLE "pipeline_transicoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"etapa_origem_id" integer NOT NULL,
	"etapa_destino_id" integer NOT NULL,
	"exige_justificativa" boolean DEFAULT false NOT NULL,
	"papeis_permitidos" "papel_usuario"[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reunioes" (
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
CREATE TABLE "tarefas_agendadas" (
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
CREATE TABLE "cron_execucoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	"status" "cron_status" DEFAULT 'em_execucao' NOT NULL,
	"itens_processados" integer DEFAULT 0 NOT NULL,
	"erro" text
);
--> statement-breakpoint
CREATE TABLE "importacoes" (
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
CREATE TABLE "migracao_registros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origem" text NOT NULL,
	"id_externo" text NOT NULL,
	"entidade" text NOT NULL,
	"id_destino" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campanhas" (
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
CREATE TABLE "envios_campanha" (
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
CREATE TABLE "whatsapp_mensagens" (
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
ALTER TABLE "empresa_configuracoes" ADD CONSTRAINT "empresa_configuracoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresas_usuarios" ADD CONSTRAINT "empresas_usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresas_usuarios" ADD CONSTRAINT "empresas_usuarios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas" ADD CONSTRAINT "contas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_enviado_por_usuarios_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_realizada_por_usuarios_id_fk" FOREIGN KEY ("realizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadencia_atividades" ADD CONSTRAINT "cadencia_atividades_anexo_id_anexos_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."anexos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_etapa_origem_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_origem_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_etapa_destino_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_destino_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidade_eventos" ADD CONSTRAINT "oportunidade_eventos_ator_id_usuarios_id_fk" FOREIGN KEY ("ator_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_etapa_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oportunidades" ADD CONSTRAINT "oportunidades_motivo_perda_id_motivos_perda_id_fk" FOREIGN KEY ("motivo_perda_id") REFERENCES "public"."motivos_perda"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_transicoes" ADD CONSTRAINT "pipeline_transicoes_etapa_origem_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_origem_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_transicoes" ADD CONSTRAINT "pipeline_transicoes_etapa_destino_id_pipeline_etapas_id_fk" FOREIGN KEY ("etapa_destino_id") REFERENCES "public"."pipeline_etapas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reunioes" ADD CONSTRAINT "reunioes_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reunioes" ADD CONSTRAINT "reunioes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reunioes" ADD CONSTRAINT "reunioes_anexo_id_anexos_id_fk" FOREIGN KEY ("anexo_id") REFERENCES "public"."anexos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_agendadas" ADD CONSTRAINT "tarefas_agendadas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_agendadas" ADD CONSTRAINT "tarefas_agendadas_oportunidade_id_oportunidades_id_fk" FOREIGN KEY ("oportunidade_id") REFERENCES "public"."oportunidades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarefas_agendadas" ADD CONSTRAINT "tarefas_agendadas_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_campanha" ADD CONSTRAINT "envios_campanha_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_campanha" ADD CONSTRAINT "envios_campanha_campanha_id_campanhas_id_fk" FOREIGN KEY ("campanha_id") REFERENCES "public"."campanhas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "empresa_configuracoes_empresa_chave_unica" ON "empresa_configuracoes" USING btree ("empresa_id","chave");--> statement-breakpoint
CREATE UNIQUE INDEX "empresas_slug_unico" ON "empresas" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_unico" ON "usuarios" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "sessoes_token_unico" ON "sessoes" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "cadencia_atividades_oportunidade_sequencia_unica" ON "cadencia_atividades" USING btree ("oportunidade_id","sequencia");--> statement-breakpoint
CREATE UNIQUE INDEX "motivos_perda_nome_unico" ON "motivos_perda" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_transicoes_origem_destino_unica" ON "pipeline_transicoes" USING btree ("etapa_origem_id","etapa_destino_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migracao_registros_origem_id_externo_unica" ON "migracao_registros" USING btree ("origem","id_externo");
-- T-290 (fase4-card-abas, US-114, AC-744 a AC-747): áudio e arquivos na conversa do WhatsApp. A mensagem passa a poder carregar
-- uma mídia: o tipo (áudio, imagem, vídeo, documento ou figurinha), o mimetype, o nome do arquivo e, quando o arquivo já está no
-- volume do servidor, o caminho dele. Recebida: o arquivo é buscado na Evolution só quando alguém abre a mídia (e fica guardado);
-- enviada: o arquivo é guardado na hora do envio. Mensagens antigas ficam sem mídia (colunas vazias). Escrita à mão, no estilo da 0020.

ALTER TABLE "whatsapp_mensagens" ADD COLUMN "midia_tipo" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD COLUMN "midia_mimetype" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD COLUMN "midia_nome" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD COLUMN "midia_arquivo" text;--> statement-breakpoint
ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_midia_tipo_valido" CHECK ("midia_tipo" IS NULL OR "midia_tipo" IN ('audio', 'imagem', 'video', 'documento', 'figurinha'));

-- T-301 (fase4-tarefas-agenda, US-122, AC-765 a AC-770): a sala do Google Meet de cada reunião. O evento é criado no Google Calendar da conta
-- que a empresa conectou (o id do evento já tinha a coluna `calendar_event_id`); aqui entra o link da sala. Reuniões antigas ficam sem link
-- (coluna vazia). Escrita à mão, no estilo da 0020.

ALTER TABLE "reunioes" ADD COLUMN "meet_url" text;

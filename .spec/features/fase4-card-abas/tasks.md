# Tasks: Fase4 card abas

> feature: fase4-card-abas

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - T-xxx = tarefa (código de rastreio, único no projeto inteiro).
  - Toda tarefa referencia em `Refs:` pelo menos uma história de usuário
    (US-xxx) ou critério de aceite (AC-xxx).
  - Toda tarefa lista os arquivos que cria/altera em `Arquivos:` — capriche:
    é o que decide o que `onp-spec plano` roda em PARALELO (arquivos
    disjuntos) e o que roda em sequência.
  - Campos opcionais por tarefa, usados pelo plano de execução:
    `- Modelo: claude-sonnet-5` e `- Esforço: alto` (baixo|medio|alto|xalto|max).
  - Uma tarefa só pode virar [concluida] quando os critérios de aceite dela
    tiverem prova PASS registrada por `onp-spec verify`.
  Status: pendente | em-andamento | concluida
    (atalho: `onp-spec tarefa <feature> <T-xxx> <status>`)
-->

## T-168 — Nome original do anexo: migration 0013 e upload [concluida]
- Refs: AC-428
- Arquivos: drizzle/0013_anexos_nome.sql, src/db/schema/pipeline.ts, src/lib/anexos/nome.ts, src/repositories/anexos.ts, src/app/api/anexos/route.ts, test/api/anexos-nome.test.ts
- Esforço: alto
- Notas: migration escrita à mão (mesmo estilo de 0011 e 0012; o diário `drizzle/meta` só registra as geradas): `ALTER TABLE anexos ADD COLUMN nome text` (nula, sem default), com a mesma política de acesso da tabela. `nome.ts` limpa o nome do arquivo (só o último trecho do caminho, sem caracteres de controle, até 120 caracteres; vazio vira nulo). O `POST /api/anexos` passa o `File.name` limpo para `criarAnexo`. Anexos antigos ficam com nome nulo (a tela mostra "Anexo PDF — data"). A migration entra na lista de pendências do cutover (como 0012). Não mexe no que já funciona: os testes de `anexos-upload` e `anexos-acesso` têm que continuar passando.

## T-169 — Listagem dos anexos do card (servidor) [concluida]
- Refs: AC-423, AC-424
- Arquivos: src/repositories/anexos-lista.ts, src/app/api/oportunidades/[id]/anexos/route.ts, test/api/oportunidade-anexos-lista.test.ts
- Esforço: medio
- Notas: `GET /api/oportunidades/[id]/anexos` com o mesmo padrão de sessão e tenant das rotas de `/api/oportunidades` (401 antes de tocar no banco; card de outra empresa = 404). Cada item: id, nome (ou nulo), mime, tamanho, hash, quem enviou (nome), criadoEm e `evidencia: { etapaId, etapaNome } | null` (anexo que aparece como `anexo_id` de um evento de transição do card; ASM-143). Ordem: mais novo primeiro. Depende de T-168 (coluna `nome`).

## T-170 — Listagem da cadência do card (servidor) [concluida]
- Refs: AC-430, AC-431
- Arquivos: src/repositories/cadencia-card.ts, src/app/api/oportunidades/[id]/cadencia/route.ts, test/api/oportunidade-cadencia-lista.test.ts
- Esforço: medio
- Notas: `GET /api/oportunidades/[id]/cadencia` (já existe a pasta com `iniciar/route.ts`; este é o `route.ts` irmão). Devolve os toques do card em ordem de `sequencia` (dia, turno, canal, tipo, resultado, `realizadaEm`, quem fez, observação), mais `concluidos`, `total` (18), o id e a sequência do toque da vez, `cadenciaEncerrada` e a situação da régua (ASM-145: encerrada, com toque atrasado ou em andamento; atrasado segue a mesma regra de `listarFilaDoTurno`, sem duplicá-la). Card sem cadência iniciada devolve lista vazia, não erro. Tenant-safe como as outras rotas.

## T-171 — Molde do card: cabeçalho e abas compartilhados [concluida]
- Refs: AC-419, AC-420, AC-421, AC-422
- Arquivos: src/components/pipeline/card/molde-do-card.tsx, src/components/pipeline/card/abas-do-card.tsx, src/components/pipeline/card/use-contadores-do-card.ts, src/components/pipeline/detalhe/cabecalho-card.tsx, src/app/(app)/pipeline/[id]/page.tsx, test/components/pipeline/molde-do-card.test.tsx
- Esforço: xalto
- Notas: extrai do Resumo (`src/app/(app)/pipeline/[id]/page.tsx`) o caminho "Voltar ao funil", o nome, o selo da etapa, o responsável e a barra de abas, em `MoldeDoCard` (ASM-141: componente, não `layout.tsx`). O molde busca o card (`GET /api/oportunidades/[id]`), os contadores (`/anexos` e `/cadencia`) e trata "não encontrado", carregando e erro. O Resumo passa a usar o molde **sem mudar o que mostra**: `detalhe.test.tsx` e `iniciar-cadencia.test.tsx` continuam passando sem editar a asserção (podem precisar ajustar só o mock de fetch). Fonte visual: o cabeçalho de `docs/ui/stitch_medcrm_interface_design/10._pipeline_id_cadencia_cad_ncia_do_card/`. Depende de T-169 e T-170.

## T-172 — Tela de anexos e evidências [concluida]
- Refs: AC-422, AC-424, AC-425, AC-426, AC-427, AC-428, AC-429
- Arquivos: src/app/(app)/pipeline/[id]/anexos/page.tsx, src/components/pipeline/anexos/lista-anexos.tsx, src/components/pipeline/anexos/filtros-anexos.tsx, src/components/pipeline/anexos/envio-anexos.tsx, test/components/pipeline/anexos-tela.test.tsx
- Esforço: xalto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/12._pipeline_id_anexos_prints_e_evid_ncias_do_card/` (`code.html` e `screen.png`). Lista de T-169, busca e chips (Todos, Evidências, PDFs, Imagens, com contagem), "Link Seguro (15m)" e baixar pela rota assinada `/api/anexos/[id]`, envio por arrastar ou escolher via `POST /api/anexos` (PDF até 10 MB; PNG, JPG e WebP até 5 MB; mensagens de 415 e 413). Nome do arquivo: o gravado, ou "Anexo PDF — data" quando nulo. "em breve": Exportar Dossiê, Mover Etapa, Tornar Evidência, excluir, marcar como evidência e vincular à etapa. **Fora** (sem dado): selos aprovada/em revisão, governança ISO e espaço usado. Reaproveita as peças de `src/components/pipeline/pecas/` (estados, selo em breve). Depende de T-168, T-169 e T-171.

## T-173 — Tela da cadência de 18 toques [concluida]
- Refs: AC-422, AC-431, AC-432, AC-433, AC-434, AC-435, AC-436
- Arquivos: src/app/(app)/pipeline/[id]/cadencia/page.tsx, src/components/pipeline/cadencia/resumo-cadencia.tsx, src/components/pipeline/cadencia/toque-da-vez.tsx, src/components/pipeline/cadencia/matriz-toques.tsx, src/components/pipeline/cadencia/historico-toques.tsx, test/components/pipeline/cadencia-tela.test.tsx
- Esforço: xalto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/10._pipeline_id_cadencia_cad_ncia_do_card/`. Resumo (progresso N de 18, toque da vez, respostas "conectou" e "sem resposta", situação da régua), destaque do toque da vez com "Registrar Sucesso" e "Não Atendeu" (`POST /api/atividades/[id]/concluir` com `conectou` e `sem_resposta`, com as mensagens de TURNO_NAO_LIBERADO, BLOCO_ANTERIOR_PENDENTE, CADENCIA_ENCERRADA e CONFLITO_DE_VERSAO), matriz por dia e turno (3 toques por turno) e histórico com filtro por canal e "Ver conversa". Estado vazio com "Iniciar cadência" (reaproveita `botao-iniciar-cadencia.tsx`). "em breve": Pausar, Reiniciar régua, Pediu retorno mais tarde, Exportar PDF, Editar Script. **Fora** (sem dado): script recomendado, taxa de engajamento, SLA. Depende de T-170 e T-171.

## T-174 — Tela da conversa de WhatsApp do lead [concluida]
- Refs: AC-422, AC-437, AC-438, AC-439, AC-440, AC-441, AC-442, AC-443, AC-444
- Arquivos: src/app/(app)/pipeline/[id]/conversa/page.tsx, src/components/pipeline/conversa/conversa-lead.tsx, src/components/pipeline/conversa/seletor-telefone.tsx, src/components/pipeline/conversa/faixa-conexao.tsx, src/components/pipeline/conversa/painel-lateral.tsx, src/components/pipeline/conversa/formatos.ts, src/components/pipeline/conversa/seletor-telefone.tsx, src/components/pipeline/conversa/faixa-conexao.tsx, src/components/shell/use-contadores.ts, test/components/pipeline/conversa-tela.test.tsx
- Esforço: xalto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/11._pipeline_id_conversa_whatsapp_do_lead/`. Histórico de `GET /api/whatsapp/messages?leadId=` (separador de dia, hora, status traduzido, ASM-146), seletor de telefone com `GET /api/leads/[id]/telefones`, envio por `POST /api/whatsapp/send` com `leadId` e `telefoneId`, `POST /api/whatsapp/lidas` ao abrir, faixa de conexão com `GET /api/whatsapp/status`, mensagem nova pelo evento `mensagem.recebida` do SSE existente (hook `use-stream-oportunidades.ts`, sem editá-lo) e painel lateral com a cadência (de T-170) e as notas internas (de `/api/oportunidades/[id]/anotacoes`, T-156 da feature anterior). "em breve": Ligar Agora (Q-049), Novo Número, busca, menu, anexar, templates e respostas rápidas. **Fora** (sem dado): Dados da Proposta e Qualificação Técnica. Não reaproveitar `src/components/whatsapp/whatsapp-inbox-chat.tsx` (é do legado, em Supabase). O menu lateral só lia o contador de não lidas ao abrir a tela: `use-contadores.ts` passa a escutar o evento `crm:contadores-mudaram`, que a conversa dispara depois de marcar como lidas (AC-440). Depende de T-170 e T-171.

## T-175 — Garantia: as quatro abas existem e nenhuma dá 404 [concluida]
- Refs: AC-419
- Arquivos: test/components/pipeline/abas-sem-404.test.ts
- Esforço: baixo
- Notas: lição da PR #37 (o teste só conferia o `href`, e as rotas não existiam). Este teste lê a lista de abas do `MoldeDoCard` e confere que, para cada `href` gerado, existe o `page.tsx` correspondente em `src/app/(app)/pipeline/[id]/`. Roda por último.

## T-288 — A conversa do card: botões que funcionam (mover etapa, novo número, busca, menu, respostas rápidas, templates) [pendente]
- Refs: US-111, US-114, AC-444, AC-739, AC-740, AC-741
- Arquivos: src/components/pipeline/card/use-transicao-do-card.ts, src/components/pipeline/card/molde-do-card.tsx, src/components/pipeline/conversa/conversa-lead.tsx, src/components/pipeline/conversa/modal-novo-numero.tsx, src/components/pipeline/conversa/menu-opcoes.tsx, src/components/pipeline/conversa/respostas-e-templates.tsx, src/app/(app)/pipeline/[id]/conversa/page.tsx, test/components/pipeline/conversa-tela.test.tsx, test/components/pipeline/molde-do-card.test.tsx
- Notas: quinto ajuste de tela da série do dono (03/11), etapa 1 de 3 da conversa (botões; depois proposta e qualificação; depois áudio e anexos). Respostas rápidas = os primeiros templates aprovados (sem tabela nova). "Anexar arquivo" continua "em breve" até o envio de mídia. "Concluir Toque da Cadência" do protótipo continua na aba Cadência. O `AC-444` do T-174 passa a cobrir só "Anexar arquivo"; os outros itens que ele cobria viraram AC-739 a AC-741.

## T-289 — Dados da proposta e qualificação técnica na conversa do card [pendente]
- Refs: US-114, AC-443, AC-742, AC-743
- Arquivos: drizzle/0026_oportunidade_comercial.sql, src/db/schema/pipeline.ts, src/repositories/dados-comerciais.ts, src/repositories/edicao-card.ts, src/repositories/linha-do-tempo.ts, src/app/api/oportunidades/[id]/comercial/route.ts, src/components/pipeline/conversa/blocos-comerciais.tsx, src/components/pipeline/conversa/painel-lateral.tsx, src/components/pipeline/card/molde-do-card.tsx, src/app/(app)/pipeline/[id]/conversa/page.tsx, test/api/dados-comerciais.test.ts, test/components/pipeline/blocos-comerciais.test.tsx, test/components/pipeline/conversa-tela.test.tsx
- Notas: sexto ajuste de tela da série do dono (03/11), etapa 2 de 3 da conversa. Decisões dele: usar os campos do protótipo, editáveis na tela, qualquer papel edita. Tabela nova `oportunidade_comercial` (uma linha por card, criada na primeira edição, RLS por empresa) na migration 0026, escrita à mão. **A migration 0026 precisa ser aplicada em `crm_prod` e no staging antes do deploy** (runbook do cutover). O MRR ofertado é `oportunidades.valor`, editado pelo `PATCH /api/oportunidades/:id` (T-287). O AC-443 (T-174) deixa de dizer que os blocos não aparecem.

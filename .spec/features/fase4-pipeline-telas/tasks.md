# Tasks: Fase4 pipeline telas

> feature: fase4-pipeline-telas

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

## T-154 — Consultas do servidor: lista paginada, arquivados e indicadores [concluida]
- Refs: AC-389, AC-395, AC-396, AC-397, AC-398, AC-402, AC-403
- Arquivos: src/repositories/pipeline-lista.ts, src/repositories/pipeline-indicadores.ts, test/repositories/pipeline-lista.test.ts
- Esforço: alto
- Notas: repositórios novos, sem tocar em `oportunidades.ts`. Tudo fail-closed por tenant (mesmo padrão `comTenant` de fase1). Lista: etapas 1 a 13; arquivados: etapas 14 e 15 (ASM-133); data de fechamento = último evento `transicao_etapa` para a etapa terminal, com `atualizado_em` como reserva (ASM-134). Indicadores seguem a ASM-135 (a conversão e a fila de atraso reaproveitam as definições de `kpis.ts` e de `atividades`, sem duplicar a regra). Filtros: etapa, responsável, origem, motivo de perda, período, texto (nome, e-mail e telefone); ordenação por valor, próxima ação e criado em; tamanhos de página 10, 25 e 50.

## T-155 — Rotas de leitura: lista, arquivados e indicadores [pendente]

- Refs: AC-389, AC-395, AC-396, AC-397, AC-398, AC-402, AC-403
- Arquivos: src/app/api/oportunidades/lista/route.ts, src/app/api/oportunidades/arquivados/route.ts, src/app/api/pipeline/indicadores/route.ts, test/api/pipeline-leitura.test.ts
- Esforço: medio
- Notas: `GET /api/oportunidades/lista`, `GET /api/oportunidades/arquivados` e `GET /api/pipeline/indicadores?visao=funil|arquivados`. Mesmo padrão de sessão das rotas de `/api/oportunidades` (401 antes de tocar no banco; `empresaId` da URL é ignorado). Valida e normaliza os parâmetros (página mínima 1; `porPagina` fora de 10/25/50 vira 10). Depende de T-154.

## T-156 — Reabrir card e registrar anotação [pendente]

- Refs: AC-404, AC-409
- Arquivos: src/app/api/oportunidades/[id]/reabrir/route.ts, src/app/api/oportunidades/[id]/anotacoes/route.ts, src/repositories/anotacoes.ts, test/api/pipeline-escrita.test.ts
- Esforço: alto
- Notas: reabrir usa a transição existente (`14→5` e `15→13`, com justificativa) mais uma checagem de papel por cima: só MASTER e GERENTE, ATENDENTE recebe 403 (ASM-138; o grafo do seed permite os três papéis e não é alterado). Anotação = evento `anotacao` em `atividades` com texto e autor (ASM-139; confirmar na tarefa se `atividades.tipo` aceita o valor sem migration, senão parar e perguntar).

## T-157 — Linha do tempo do card [pendente]

- Refs: AC-407, AC-408
- Arquivos: src/app/api/oportunidades/[id]/linha-do-tempo/route.ts, src/repositories/linha-do-tempo.ts, test/api/pipeline-linha-do-tempo.test.ts
- Esforço: medio
- Notas: `GET /api/oportunidades/[id]/linha-do-tempo?tipo=&pagina=`: eventos de `atividades` do card, do mais novo ao mais antigo, com tipo, texto, autor e data, mais a contagem de interações. Card de outra empresa ou inexistente = 404 sem vazar dado (AC-412). O detalhe também precisa dos telefones do lead: reaproveitar `GET /api/leads/[id]/telefones`, sem rota nova.

## T-158 — Peças de tela compartilhadas e estados [pendente]

- Refs: AC-393, AC-405, AC-413
- Arquivos: src/components/pipeline/pecas/cartao-indicador.tsx, src/components/pipeline/pecas/paginacao.tsx, src/components/pipeline/pecas/selo-etapa.tsx, src/components/pipeline/pecas/selo-em-breve.tsx, src/components/pipeline/pecas/estados.tsx, test/components/pipeline/pecas.test.tsx
- Esforço: alto
- Notas: cartão de indicador (como o do `6._pipeline_funil_pipeline/code.html` e do `7`), paginação "Exibindo N a M de T", selo de etapa por cor, selo "em breve" (o mesmo da fase 4, reaproveitar se já existir em `src/components/shell`) e os três estados: esqueleto de carregamento, vazio com próximo passo e erro com "Tentar de novo". Ficam em `pecas/` para que as quatro telas as usem sem colidir arquivos. Roda antes das telas.

## T-159 — Tempo real nas telas do pipeline [pendente]

- Refs: AC-416
- Arquivos: src/hooks/use-stream-oportunidades.ts, src/components/pipeline/pecas/aviso-tempo-real.tsx, test/components/pipeline/tempo-real.test.tsx
- Esforço: medio
- Notas: o hook atual já escuta `oportunidade.movida` para o funil antigo; passa a aceitar um callback genérico (o funil move o card, lista e arquivados recarregam a página atual e os indicadores) e a expor o estado da conexão para o aviso "tempo real desconectado". Não pode quebrar o uso atual em `board-kanban.tsx` até T-160 trocá-lo. Eventos de outra empresa nunca chegam (isolamento já vem do barramento; o teste prova).

## T-160 — Tela do funil (Kanban) com indicadores, filtros e novo lead [pendente]

- Refs: AC-387, AC-388, AC-390, AC-391, AC-392, AC-393
- Arquivos: src/app/(app)/pipeline/page.tsx, src/components/pipeline/board-kanban.tsx, src/components/pipeline/coluna-etapa.tsx, src/components/pipeline/card-oportunidade.tsx, src/components/pipeline/filtros-funil.tsx, src/components/pipeline/modal-novo-lead.tsx, src/components/pipeline/indicadores-funil.tsx, test/components/pipeline/funil.test.tsx, test/components/pipeline/modal-novo-lead.test.tsx
- Esforço: xalto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/6._pipeline_funil_pipeline/` (`code.html` e `screen.png`). Move `/pipeline` para o grupo `(app)` (URL igual) e apaga `src/app/pipeline/page.tsx`. Mantém o drag-and-drop, o modal de dado faltante e o botão de iniciar cadência existentes. Etapas com os nomes do banco (ASM-132). Contagem e soma por coluna vêm dos cards carregados; indicadores de `/api/pipeline/indicadores?visao=funil`. "Salvar e iniciar cadência" chama `POST /api/oportunidades` e depois `/api/oportunidades/[id]/cadencia/iniciar`. Origem do modal: valores existentes mais "Outro" (ASM-137). Depende de T-155, T-158 e T-159.

## T-161 — Tela da lista [pendente]

- Refs: AC-394, AC-395, AC-396, AC-399
- Arquivos: src/app/(app)/pipeline/lista/page.tsx, src/components/pipeline/tabela-lista.tsx, src/components/pipeline/filtros-lista.tsx, test/components/pipeline/lista.test.tsx
- Esforço: alto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/7._pipeline_lista_vis_o_em_lista/`. Estado dos filtros e da página na URL (`?pagina=2&etapa=…`), para recarregar e compartilhar. Seleção por linha e por cabeçalho; as ações em lote aparecem "em breve" (feature `fase4-pipeline-lote`). Depende de T-155, T-158 e T-159.

## T-162 — Tela dos arquivados [pendente]

- Refs: AC-400, AC-401, AC-403, AC-404, AC-405
- Arquivos: src/app/(app)/pipeline/arquivados/page.tsx, src/components/pipeline/tabela-arquivados.tsx, src/components/pipeline/distribuicao-motivos.tsx, src/components/pipeline/botao-reabrir.tsx, test/components/pipeline/arquivados.test.tsx
- Esforço: alto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/8._pipeline_arquivados_cards_arquivados/`. Abas Todos, Ganhos e Perdidos com contagem. "Reabrir" pede a justificativa e chama a rota de T-156; desabilitado para ATENDENTE. "Exportar Relatório", "Análise de Motivos de Perda", "Top Fechamentos" e "Playbook de Reversão" ficam "em breve". Depende de T-155, T-156, T-158 e T-159.

## T-163 — Tela de detalhe do card [pendente]

- Refs: AC-406, AC-407, AC-408, AC-409, AC-410, AC-411, AC-412
- Arquivos: src/app/(app)/pipeline/[id]/page.tsx, src/components/pipeline/detalhe/cabecalho-card.tsx, src/components/pipeline/detalhe/jornada.tsx, src/components/pipeline/detalhe/informacoes.tsx, src/components/pipeline/detalhe/linha-do-tempo.tsx, src/components/pipeline/detalhe/registro-rapido.tsx, test/components/pipeline/detalhe.test.tsx
- Esforço: xalto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/9._pipeline_id_detalhe_do_card/`. Move `/pipeline/[id]` para `(app)` e apaga `src/app/pipeline/[id]/page.tsx`. **Blocos sem dado ficam fora** (decisão do usuário, 26/10): CNPJ, estrutura da clínica, valor anual, unidade física, telefone extra e e-mail extra do protótipo. Jornada com os nomes reais das 15 etapas (ASM-132). "Mover de Etapa", "Marcar como Ganho" e "Perdido" usam `/api/oportunidades/[id]/transicao` e o modal de dado faltante já existentes. Abas Cadência, WhatsApp e Anexos levam às rotas atuais (telas 10 a 12 virão depois). Depende de T-156, T-157 e T-158.

## T-164 — Permissões das novas rotas, menu e retirada da tela antiga [pendente]

- Refs: AC-414, AC-415, AC-387
- Arquivos: src/lib/auth/rotas.ts, src/components/shell/menu-config.ts, test/auth/rotas-pipeline.test.ts
- Esforço: medio
- Notas: acrescenta `/pipeline/lista` e `/pipeline/arquivados` à tabela de permissões por rota (mesmo mínimo de `/pipeline`) e os itens "Lista" e "Arquivados" ao menu, com o item ativo certo em cada tela. Confirma que não sobrou rota nem teste duplicado da tela antiga (AC-415). Roda por último.

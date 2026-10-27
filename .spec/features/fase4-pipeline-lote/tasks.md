# Tasks: Fase4 pipeline lote

> feature: fase4-pipeline-lote

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

## T-176 — Núcleo do lote: transição compartilhada e "mover em lote" (servidor) [concluida]
- Refs: AC-446, AC-447, AC-448, AC-449
- Arquivos: src/repositories/transicao-card.ts, src/repositories/lote-oportunidades.ts, src/app/api/oportunidades/[id]/transicao/route.ts, src/app/api/oportunidades/lote/mover/route.ts, test/api/lote-mover.test.ts
- Esforço: alto
- Notas: a regra da transição de um card (destino, grafo, papel, dados obrigatórios, evidência, `moverOportunidade`) hoje mora dentro de `transicao/route.ts`. Extrai para `transicionarCard(db, contexto, cardId, entrada)` em `transicao-card.ts`, que devolve `{ ok: true, card }` ou `{ ok: false, codigo }`, e a rota de um card passa a chamá-la **sem mudar nenhum comportamento** (os testes `oportunidades-transicao*.test.ts` e `oportunidades-transicao-anexo.test.ts` têm que continuar passando sem editar). `POST /api/oportunidades/lote/mover` com `{ ids, etapaDestinoId }` valida o pedido (1 a 100 ids, 400 fora disso; 401 sem sessão), lê a versão atual de cada card (ASM-151) e chama `transicionarCard` um a um, cada um na própria transação; card de outra empresa ou inexistente volta `OPORTUNIDADE_NAO_ENCONTRADA` naquele item (AC-448). Resposta: `{ resultados: [{ id, ok, codigo? }], movidos, falhas }`. O evento de card movido (NOTIFY dentro de `mover_oportunidade`) sai por card movido; o teste prova isso com o barramento existente.

## T-177 — Reatribuir e arquivar em lote, e lista de responsáveis ativos (servidor) [concluida]
- Refs: AC-448, AC-450, AC-451, AC-452, AC-453, AC-454
- Arquivos: src/repositories/lote-reatribuicao.ts, src/app/api/oportunidades/lote/reatribuir/route.ts, src/app/api/oportunidades/lote/arquivar/route.ts, src/app/api/pipeline/responsaveis/route.ts, src/repositories/linha-do-tempo.ts, src/components/pipeline/detalhe/linha-do-tempo.tsx, test/api/lote-reatribuir-arquivar.test.ts
- Esforço: alto
- Notas: `POST /api/oportunidades/lote/reatribuir` `{ ids, responsavelId }`: só MASTER/GERENTE/super admin (403 para ATENDENTE, ASM-152); responsável tem que ser usuário ativo da empresa da sessão (400 `RESPONSAVEL_INVALIDO`); atualiza cada card (função `atualizarOportunidade` do repositório, que já aceita `responsavelId`) e grava o evento `reatribuicao` em `oportunidade_eventos` com de, para e autor (ASM-153; confirmar que `tipo` aceita o valor sem migration). `POST /api/oportunidades/lote/arquivar` `{ ids, motivoPerdaId }` chama `transicionarCard` (de T-176) com destino 14 e o motivo; sem motivo = 400 `MOTIVO_OBRIGATORIO`. `GET /api/pipeline/responsaveis` lista id, nome e papel dos usuários **ativos da empresa da sessão** (a `/api/usuarios` existente é do legado em Supabase e não serve). A linha do tempo do detalhe passa a mostrar "Responsável alterado: de X para Y" (rótulo e ícone do novo tipo). Depende de T-176.

## T-178 — Barra de ações em lote na lista (tela) [concluida]
- Refs: AC-445, AC-446, AC-447, AC-450, AC-451, AC-453, AC-454
- Arquivos: src/components/pipeline/tabela-lista.tsx, src/components/pipeline/lote/barra-lote.tsx, src/components/pipeline/lote/dialogo-lote.tsx, src/components/pipeline/lote/resultado-lote.tsx, src/app/(app)/pipeline/lista/page.tsx, test/components/pipeline/lote-tela.test.tsx
- Esforço: xalto
- Notas: fonte visual `docs/ui/stitch_medcrm_interface_design/7._pipeline_lista_vis_o_em_lista/` (a barra azul "N clínicas selecionadas no grid"). Troca os três `ItemEmBreve` de `tabela-lista.tsx` por botões que abrem um diálogo: **Mover Etapa em Lote** (seletor das 15 etapas), **Reatribuir Comercial** (responsáveis de `GET /api/pipeline/responsaveis`) e **Arquivar** (motivos de `GET /api/motivos-perda`, motivo obrigatório e segundo clique para confirmar, mostrando a quantidade). "Disparar WhatsApp" continua `ItemEmBreve`. O ATENDENTE vê "Reatribuir Comercial" desabilitado (papel de `GET /api/me`). Depois do lote, painel de resultado "N movidos, M não movidos" com o nome do lead e o motivo em português de cada falha, a lista recarrega e os que falharam seguem marcados. Mensagens por código: `TRANSICAO_NAO_PERMITIDA`, `PAPEL_NAO_PERMITIDO`, dado faltante, `CONFLITO_DE_VERSAO`, `OPORTUNIDADE_NAO_ENCONTRADA`. Depende de T-176 e T-177.

## T-179 — Exportar em CSV (servidor) e registro das exportações [concluida]
- Refs: AC-455, AC-456, AC-457, AC-458, AC-459
- Arquivos: drizzle/0014_auditoria_exportacoes.sql, src/db/schema/pipeline.ts, src/lib/csv/gerar-csv.ts, src/repositories/exportar-carteira.ts, src/repositories/pipeline-lista.ts, src/app/api/oportunidades/lista/exportar/route.ts, src/app/api/oportunidades/arquivados/exportar/route.ts, test/lib/gerar-csv.test.ts, test/api/exportar-csv.test.ts
- Esforço: alto
- Notas: migration escrita à mão (mesmo estilo de 0011 a 0013), com o nome `auditoria_exportacoes` (empresa, usuário, tela, filtros em jsonb, linhas, criado em) e isolamento por empresa como as demais tabelas (`drizzle/0001_rls.sql`); vai para a lista de pendências do cutover (ASM-156). Número **0014**: a 0013 já é a do nome do anexo (`fase4-card-abas`). `gerar-csv.ts`: ponto e vírgula, BOM, aspas, datas dd/mm/aaaa hh:mm, valor com vírgula e apóstrofo antes de `=`, `+`, `-`, `@` (ASM-155, AC-458). As duas rotas só deixam MASTER/GERENTE/super admin (403 ATENDENTE, 401 sem sessão), reusam os filtros de `pipeline-lista.ts` (exportar o construtor de condições, sem duplicar regra) sem a paginação, recusam mais de 5.000 linhas (422 `LIMITE_EXCEDIDO`) e só gravam o registro quando o arquivo é de fato entregue. Nome do arquivo com a data.

## T-180 — Botões "Exportar CSV" na lista e nos arquivados (tela) [concluida]
- Refs: AC-455, AC-456, AC-457, AC-460
- Arquivos: src/components/pipeline/lote/botao-exportar.tsx, src/app/(app)/pipeline/lista/page.tsx, src/app/(app)/pipeline/arquivados/page.tsx, test/components/pipeline/exportar-tela.test.tsx
- Esforço: medio
- Notas: troca os `ItemEmBreve` "Exportar CSV/XLS" (lista) e "Exportar Relatório" (arquivados) por um botão "Exportar CSV" que pede o arquivo com os **mesmos filtros e aba da tela** (query igual à da listagem, sem página), baixa pelo navegador, mostra "Gerando..." e trata: sem cards ("Nenhum card para exportar com estes filtros"), `LIMITE_EXCEDIDO` ("Muitos cards para exportar: refine os filtros") e falha genérica. O botão **não aparece** para ATENDENTE (papel de `GET /api/me`). Depende de T-178 (mesma página da lista) e T-179.

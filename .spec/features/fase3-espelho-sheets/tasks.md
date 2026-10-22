# Tasks: Fase3 espelho sheets

> feature: fase3-espelho-sheets

## T-132 — Montar as linhas do espelho e proteger contra fórmulas [concluida]
- Refs: AC-329, AC-330, AC-335
- Arquivos: src/espelho/linhas.ts, test/espelho/linhas.spec.test.ts
- Notas: função pura. Cabeçalho fixo "Espelho CRM" (nome, telefone, e-mail, etapa, responsável, valor, motivo de perda, criado em, atualizado em, dia da cadência, turno, tentativas, próxima ação) e uma linha por card. Células de texto começando com `=`, `+`, `-` ou `@` recebem prefixo `'` para o Sheets não interpretar fórmula. Datas em America/Sao_Paulo. Sem cadência, colunas de cadência em branco.

## T-133 — Consultar no banco os cards da empresa do Sheets [concluida]
- Refs: AC-329, AC-330, AC-331
- Arquivos: src/espelho/consulta.ts, test/espelho/consulta.spec.test.ts
- Notas: lê oportunidades + lead + etapa + responsável + motivo de perda da empresa `medguia` (ASM-118), todas as etapas inclusive Ganho/Perdido (ASM-115). Tentativas = atividades de `cadencia_atividades` com resultado diferente de `pendente` (ASM-117). Teste de integração com Postgres efêmero (`test/support/postgres-efemero.ts`) e duas empresas. Só leitura; nenhuma escrita no banco.

## T-134 — Gravar o espelho na aba "Espelho CRM" [concluida]
- Refs: AC-332, AC-333, AC-339
- Arquivos: src/espelho/gravar.ts, test/espelho/gravar.spec.test.ts
- Notas: recebe as linhas já prontas (as linhas vêm antes de qualquer chamada ao Sheets, AC-339); cria a aba se não existir, faz `values.clear` e `values.update` com `valueInputOption: 'RAW'` na planilha `GOOGLE_SHEET_ID_1` (ASM-114, ASM-116); sem linha antiga sobrando. Cliente do Sheets injetado (teste com dublê). Erro do Sheets sobe como exceção para o ciclo registrar; nunca limpa a aba se a leitura do banco falhou.

## T-135 — Provar que a ingestão não lê o espelho nem o CRM lê a edição [concluida]
- Refs: AC-333, AC-334
- Arquivos: test/espelho/isolamento.spec.test.ts
- Notas: só teste. Com a aba "Espelho CRM" presente na planilha 1, as abas lidas pela importação continuam sendo as quatro de leads + `Agenda` (`ABAS_DE_LEADS`, `AGENDA_RANGE` em src/worker/index.ts), e uma linha editada no espelho não cria nem altera lead/card. Se o teste achar um problema na ingestão, vira nova tarefa.

## T-136 — Ligar o espelho no worker: ciclo, intervalo e registro [pendente]

- Refs: AC-336, AC-337, AC-339
- Arquivos: src/worker/config.ts, src/worker/index.ts, test/worker/espelho.spec.test.ts
- Notas: `WORKER_INTERVALO_ESPELHO_MIN` (padrão 15, ASM-120), validado como `WORKER_INTERVALO_IMPORT_MIN`. Roda o job `espelho-sheets` com `rodarCicloImportacao` de src/worker/ciclo.ts (trava advisory, `cron_execucoes`, erro sem segredos), num agendador próprio com o intervalo do espelho. Depende de T-132, T-133 e T-134.

## T-137 — Saúde do worker acusa espelho atrasado [pendente]

- Refs: AC-338
- Arquivos: src/worker/saude.ts, test/worker/saude-espelho.spec.test.ts
- Notas: inclui o job `espelho-sheets` na verificação, com prazo de 45 min (TDD-001 §8) em vez de 2× o intervalo de importação; sem nenhuma execução conta como doente. Independente das demais: só lê `cron_execucoes`.

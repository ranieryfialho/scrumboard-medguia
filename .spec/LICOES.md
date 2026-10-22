# LIÇÕES — mantido pelo motor (`onp-spec licoes`)

> Não edite à mão: qualquer escrita do motor sobrescreve este arquivo.
> Estado canônico em `.spec/licoes.json`; mutação só via `onp-spec licoes`.

## Confirmadas — carregue no Especificar/Projetar

Corroboradas em múltiplas features. Aplique como guia.

_nenhuma_

## Candidatas — em observação, NÃO aplicar ainda

Vistas em uma feature só. Registradas, não confiadas.

### L-001 — O título de todo teste de critério de aceite termina com (@spec:AC-xxx); prefixo 'AC-xxx:' não conta como prova, então confira com grep '@spec:AC-' antes de encerrar a tarefa.
- sinal: `AC_SEM_TESTE` · recorrência: 1 feature(s) · escopo: `testes` · penalidades: 0
- features: fase3-etl-decisoes
- última evidência: AC-309 (fase3-etl-decisoes, 2026-10-21T15:51:19.171Z)

### L-002 — Ao escrever o tasks.md, cruze a lista de critérios de aceite com os campos Refs das tarefas antes de começar a executar: todo critério precisa de pelo menos uma tarefa.
- sinal: `AC_SEM_TASK` · recorrência: 1 feature(s) · penalidades: 0
- features: fase2-kanban
- última evidência: AC-079 (fase2-kanban, 2026-10-22T15:48:52.881Z)

### L-003 — Só marque a tarefa como concluída depois que o verify gravar PASS para os critérios dela; teste escrito ou código pronto não basta.
- sinal: `TASK_CONCLUIDA_SEM_PROVA` · recorrência: 1 feature(s) · penalidades: 0
- features: fase2-kanban
- última evidência: T-046 (fase2-kanban, 2026-10-22T15:48:52.942Z)

## Quarentena — aplicadas e falharam, ignorar

A falha recorreu mesmo com a lição aplicada. Revisão é do usuário.

_nenhuma_

# Spec: Fase3 ingestao continua

> feature: fase3-ingestao-continua
> status: rascunho

## Contexto

Depois do cutover, os leads continuam **entrando** pelo Google Sheets e pela landing page (RFC-001 §5 D2 passo 4, TDD-001). Os ETLs de carga única (`fase3-etl-sheets`, `fase3-etl-lp`) já sabem ler essas origens sem duplicar ninguém, mas só rodam à mão. Esta feature é o **`crm-worker`** (D-S6: container Node com `node-cron`): um processo próprio que repete essas importações em intervalo fixo, registra cada execução em `cron_execucoes`/`importacoes` e nunca cai por causa de uma origem fora do ar. O relógio da cadência e o espelho no Sheets ficam de fora.

## Histórias

### US-090 — Leads novos chegam sozinhos ao funil

Como operação, quero que cadastros novos do Sheets e da landing page apareçam como cards em "Entrada de leads" sem ninguém rodar comando, para atender o lead enquanto ele está quente.

#### AC-318 — Um lead novo vira card no próximo ciclo

- **Dado** o worker ligado e um cadastro novo na planilha (ou na landing page) que ainda não está no CRM
- **Quando** o próximo ciclo de importação roda
- **Então** o lead e o card aparecem em "Entrada de leads", com o mesmo resultado do ETL de carga única
- **E** o ciclo registra quantos cadastros leu, criou e ignorou

#### AC-319 — Repetir o ciclo não duplica ninguém

- **Dado** um ciclo que já importou os cadastros de hoje
- **Quando** o ciclo roda de novo sem nenhum cadastro novo na origem
- **Então** nenhum lead nem card novo é criado e as contagens de criados ficam em zero

#### AC-320 — Os dois ciclos rodam no intervalo configurado

- **Dado** o worker com o intervalo de importação configurado
- **Quando** o tempo passa por mais de um intervalo
- **Então** o ciclo do Sheets e o da landing page rodam a cada intervalo, cada um com seu próprio registro de execução

### US-091 — Saber se a importação está saudável

Como responsável técnico, quero ver no banco e na saúde do container se a última importação deu certo, para descobrir uma falha silenciosa antes da operação.

#### AC-321 — Cada execução fica registrada com início, fim e resultado

- **Dado** um ciclo de importação
- **Quando** ele termina, com sucesso ou com erro
- **Então** `cron_execucoes` tem uma linha com o nome do job, início, fim, status e quantidade de itens
- **E** em caso de erro o texto do erro está na linha, sem chaves nem senhas

#### AC-322 — Uma origem fora do ar não derruba o worker nem a outra origem

- **Dado** a landing page fora do ar durante um ciclo
- **Quando** o ciclo roda
- **Então** a execução da LP fica como falha, a do Sheets segue normalmente e o worker continua vivo para o ciclo seguinte

#### AC-323 — O container informa se a última importação está em dia

- **Dado** o worker rodando
- **Quando** a verificação de saúde é consultada
- **Então** ela diz "saudável" se houve sucesso dentro de duas vezes o intervalo
- **E** diz "doente" se a última tentativa de cada origem falhou ou se passou desse prazo

### US-092 — Nunca importar duas vezes ao mesmo tempo

Como responsável técnico, quero que dois ciclos da mesma origem jamais se sobreponham, para não disputar a mesma transação nem gerar duplicidade.

#### AC-324 — Ciclo atrasado não começa por cima do anterior

- **Dado** um ciclo ainda em andamento quando chega o próximo horário
- **Quando** o agendador dispara de novo
- **Então** o novo disparo é pulado e registrado como "pulado", sem abrir outra importação

#### AC-325 — Dois workers não importam a mesma origem juntos

- **Dado** dois processos worker apontando para o mesmo banco
- **Quando** ambos tentam rodar o ciclo da mesma origem ao mesmo tempo
- **Então** só um importa; o outro desiste sem erro (trava consultiva do Postgres)

### US-093 — Subir e parar o worker com segurança

Como responsável técnico, quero que o worker suba em container próprio e pare sem cortar uma importação no meio, para operar sem medo em deploy.

#### AC-326 — Parar o worker espera o ciclo em andamento terminar

- **Dado** um ciclo em andamento
- **Quando** o processo recebe o sinal de parada (SIGTERM)
- **Então** o ciclo termina e é registrado, nenhum ciclo novo começa, e o processo sai com código 0

#### AC-327 — Configuração faltando impede a subida

- **Dado** uma variável obrigatória ausente (por exemplo, a URL do banco ou a chave da LP)
- **Quando** o worker é iniciado
- **Então** ele para na hora com a lista das variáveis que faltam, sem mostrar valores de nenhuma

#### AC-328 — O container crm-worker existe na composição

- **Dado** os arquivos de composição do projeto
- **Quando** o `docker compose` é validado
- **Então** há um serviço `crm-worker` que usa a imagem de worker da aplicação (`scrumboard-medguia-worker`, que traz o código do worker e o `tsx`; a imagem do site não os traz) com outro comando de entrada e o healthcheck do AC-323

## Fora de escopo

- Virada de dia da cadência (continua na rota `POST /api/cron/cadencia`, `fase2b-cadencia`).
- Espelho somente leitura no Sheets a cada 15 min (feature própria, exige credencial de escrita).
- Corrigir o RLS da LP (Q-033) e criar a chave `SUPABASE_LP_SERVICE_KEY` — pré-requisitos de ambiente.
- Deploy na VPS e cutover (CRM ainda não está em produção).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-107 | Cada ciclo reaproveita `executarMigracaoSheets` e `executarMigracaoLp` como estão: relê a origem inteira e a idempotência de `migracao_registros` evita duplicar (volume de ~70 MB não justifica leitura incremental) | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-108 | Intervalo padrão de 5 minutos para as duas origens, configurável por `WORKER_INTERVALO_IMPORT_MIN` | confirmada | Confirmado pelo usuário em 21/10 |
| ASM-109 | Sem planilha de decisões no modo contínuo: leads que o ETL manda para revisão não viram card, ficam só contados/logados e reaparecem a cada ciclo até a operação resolver pelo comando manual com `--decisoes` | confirmada | Confirmado pelo usuário em 21/10 |
| ASM-110 | A trava de não-sobreposição usa `pg_try_advisory_lock` por origem (a conexão é do worker, não do pool compartilhado) | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-111 | `importacoes` ganha uma linha por ciclo com as contagens; `cron_execucoes` guarda o resultado de saúde (jobs `import-sheets` e `import-lp`) | confirmada | Confirmado pelo usuário em 22/10 |
| ASM-112 | O agendador é `node-cron` (D-S6) e roda no mesmo repositório, com ponto de entrada `src/worker/index.ts` executado por `tsx` na imagem existente | confirmada | Confirmado pelo usuário em 22/10 |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-036 | O Sheets lido no ciclo contínuo é o mesmo conjunto de abas do ETL de carga única, ou a operação vai passar a lançar leads em uma aba nova de entrada? | respondida | Mesmas abas do ETL atual (21/10) |

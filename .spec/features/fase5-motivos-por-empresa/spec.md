# Spec: Fase 5 — Motivos de perda por empresa

> feature: fase5-motivos-por-empresa
> status: rascunho

## Contexto

O catálogo de motivos de perda era único para toda a rede: só o super admin criava ou desativava
um motivo (ASM-201). O dono do produto decidiu (Q-060) que **cada empresa cria e desativa os seus**.
Esta feature acrescenta o dono ao motivo: os motivos que já existem **continuam globais** (valem
para todas as empresas; os sistêmicos seguem intocáveis) e os novos pertencem à empresa que os
criou. Gerente, master e super admin gerenciam os da própria empresa.

## Histórias

### US-156 — Cada empresa gerencia os próprios motivos

Como gerente ou master, quero criar e desativar motivos de perda da minha empresa, para que o time
escolha só razões que fazem sentido para a minha operação.

#### AC-660 — Criar um motivo da empresa

- **Dado** um gerente (ou master) da empresa A
- **Quando** ele cria o motivo "Sem orçamento este ano" (de 3 a 80 caracteres) em `/configuracoes/motivos-perda`
- **Então** o motivo nasce ativo e pertencente à empresa A (`POST /api/configuracoes/motivos-perda`, 201); a empresa B não o vê nem o usa; atendente não cria (403)

#### AC-661 — Nome repetido é recusado só dentro do que a empresa enxerga

- **Dado** os motivos globais da rede e os da empresa A
- **Quando** o gerente da A cria um motivo com o mesmo nome (sem diferenciar maiúsculas e espaços nas pontas) de um global ou de outro da A
- **Então** a criação é recusada (409 `MOTIVO_JA_EXISTE`); a empresa B pode ter um motivo com o mesmo nome do da A

#### AC-662 — Desativar e reativar só os da própria empresa

- **Dado** um motivo da empresa A, um motivo global não sistêmico, um sistêmico e um motivo da empresa B
- **Quando** o gerente da A tenta desativar cada um (`PATCH`)
- **Então** só o da A muda; o global (qualquer um) recebe 422 `MOTIVO_DA_REDE` (só o super admin altera globais não sistêmicos, como hoje) e o sistêmico 422 `MOTIVO_SISTEMICO`; o da B é "não encontrado" (404)

#### AC-663 — A lista da administração mostra os globais e os da empresa

- **Dado** motivos globais, da empresa A e da empresa B
- **Quando** o gerente da A abre a lista
- **Então** vê os globais e os da A, nunca os da B; cada linha diz se é "Sistêmico", "Da rede" ou "Da empresa"; só os da empresa têm o botão Desativar/Ativar (o super admin também tem nos "Da rede" não sistêmicos); os totais e os cards perdidos do mês continuam só da empresa

### US-157 — Usar só os motivos que a empresa enxerga

Como atendente, quero escolher o motivo ao perder ou arquivar um card entre os da minha empresa e os da rede.

#### AC-664 — Listas de escolha

- **Dado** motivos ativos globais, da empresa A e da empresa B, e um inativo da A
- **Quando** um usuário da A abre a lista de motivos para perder um card (`GET /api/motivos-perda`)
- **Então** a lista traz os globais ativos e os ativos da A, em ordem alfabética, sem os da B e sem os inativos

#### AC-665 — O servidor recusa motivo de outra empresa

- **Dado** um card da empresa A e um motivo da empresa B
- **Quando** o card é movido para "Perdido" com esse motivo, pela transição avulsa ou pelo arquivamento em lote
- **Então** a ação é recusada (400 `MOTIVO_INVALIDO`) e o card não muda; motivo global ou da própria A passa

### US-158 — Dados antigos e relatórios

Como dono do produto, quero que a mudança não quebre o que já existe.

#### AC-666 — Os motivos atuais continuam valendo e os relatórios mostram o nome

- **Dado** a migration aplicada sobre os motivos existentes
- **Quando** se olha a base
- **Então** todos os motivos que existiam continuam globais (sem empresa), os cards perdidos continuam apontando para eles, e a tabela aceita o mesmo nome em empresas diferentes e proíbe o mesmo nome duas vezes na mesma empresa e entre globais; a cadência que esgota o prazo continua usando o motivo sistêmico "Cadência esgotada"

## Fora de escopo

- Editar o nome de um motivo, apagar motivo ou mover cards de um motivo para outro.
- Transformar um motivo global existente em motivo de uma empresa.
- Que o super admin crie motivos globais pela tela (os globais vêm da migration e do ETL).
- Isolamento por RLS na tabela de motivos: o filtro é feito nas consultas e nas validações do servidor (ASM-236).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-235 | Os motivos que já existem (inclusive os personalizados criados pelo super admin) ficam globais, com `empresa_id` vazio; a coluna é nova, anulável, e a migration não toca nos dados | aberta | É o que o dono do produto decidiu sobre "o que acontece com os atuais": nada |
| ASM-236 | `motivos_perda` continua sem RLS: o ETL e as funções de cadência leem a tabela sem contexto de empresa; o isolamento vem das consultas (`empresa_id` vazio ou igual ao da sessão) e do guard do servidor | aberta | Ligar RLS arriscaria o ETL; fica como evolução |
| ASM-237 | O nome é único entre os globais (sem diferenciar maiúsculas) e, por empresa, entre os da empresa; o app também recusa nome de empresa igual a um global | aberta | A migration troca o índice único global por dois índices parciais |
| ASM-238 | Quem gerencia: gerente, master e super admin (este atuando na empresa ativa); atendente só lê a lista de escolha | aberta | Mesma regra de acesso da tela de motivos |
| ASM-239 | Desativar um motivo da empresa não mexe nos cards que já o usam: eles seguem mostrando o nome; ele só some das listas de escolha | aberta | Igual ao comportamento atual |

## Perguntas em aberto

Nenhuma.

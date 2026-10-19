# Spec: Fase3 etl supabase

> feature: fase3-etl-supabase
> status: rascunho

## Contexto

O CRM novo precisa receber os dados do scrumboard legado antes do cutover (TDD-001, Fase 3). Esta feature cobre **só a origem Supabase do CRM** (2 empresas, 11 usuários, 35 leads, 9 campanhas, ~5.100 envios, 1.572 mensagens de WhatsApp, 9 configurações). Sheets e Supabase da LP são features seguintes. O ETL roda várias vezes (ensaios em staging, depois o cutover), então precisa ser repetível sem duplicar nada.

## Histórias

### US-069 — Migrar empresas e usuários do legado

Como operação, quero que as empresas e os usuários do legado existam no CRM novo com o mesmo identificador, para que referências históricas e vínculos continuem válidos.

#### AC-252 — Empresas migram com o mesmo id e identificador (slug)

- **Dado** 2 empresas no Supabase legado
- **Quando** o ETL roda
- **Então** o CRM novo tem as 2 empresas com o mesmo `id` e o mesmo `slug`

#### AC-253 — Usuários migram com o mesmo id e o papel traduzido

- **Dado** usuários do legado com perfil ADMIN, COMERCIAL ou MARKETING e alguns marcados como super admin
- **Quando** o ETL roda
- **Então** cada usuário existe com o mesmo `id`, vinculado à empresa de origem
- **E** ADMIN vira GERENTE, COMERCIAL e MARKETING viram ATENDENTE
- **E** cada super admin vira MASTER nas duas empresas

#### AC-254 — Usuário inativo no legado continua inativo

- **Dado** um usuário com `ativo = false` no legado
- **Quando** o ETL roda
- **Então** ele migra desativado e não consegue entrar no CRM novo

#### AC-255 — Nenhuma senha é migrada

- **Dado** usuários do legado com senha própria
- **Quando** o ETL roda
- **Então** nenhum usuário migrado tem credencial de senha, e cada um precisa redefinir a senha para entrar

### US-070 — Migrar os leads como cards do pipeline

Como operação, quero que cada lead do legado apareça como card na etapa certa do funil novo, para continuar o atendimento sem refazer o cadastro.

#### AC-256 — Lead com situação de mapa direto vira lead e card na etapa certa

- **Dado** leads com situação "Novos Leads" (ou sem situação)
- **Quando** o ETL roda
- **Então** cada um vira um lead e um card na etapa "Entrada de leads"
- **E** nome, e-mail, origem e observações do legado estão preservados

#### AC-257 — Desqualificado vira Perdido com motivo próprio da migração

- **Dado** 3 leads com situação "Desqualificado"
- **Quando** o ETL roda
- **Então** os 3 cards ficam em "Perdido" com o motivo "Desqualificado (migração)"
- **E** esse motivo existe como motivo de sistema

#### AC-258 — Cada card migrado guarda de onde veio

- **Dado** um lead migrado
- **Quando** o histórico do card é aberto
- **Então** há um evento `migrado_de` com a origem e o id externo do legado
- **E** o registro de migração liga o id do legado ao id novo

#### AC-259 — Situação sem etapa automática vai para revisão manual

- **Dado** leads com situação "Em contato" (32 no legado) ou com situação desconhecida
- **Quando** o ETL roda
- **Então** esses leads NÃO são migrados nem descartados em silêncio
- **E** cada um aparece na fila de revisão manual com o motivo

#### AC-272 — A decisão da operação cria o card na etapa escolhida

- **Dado** um lead na fila de revisão e um arquivo de decisões em que a operação escolheu a etapa dele
- **Quando** o ETL roda de novo
- **Então** o lead e o card são criados na etapa escolhida
- **E** o lead sai da fila, sem duplicar nada

#### AC-260 — WhatsApp inválido não bloqueia a migração do lead

- **Dado** um lead com número de WhatsApp que não vira telefone válido
- **Quando** o ETL roda
- **Então** o lead migra sem telefone e entra na fila de revisão manual
- **E** números válidos ficam no formato internacional (E.164)

### US-071 — Migrar campanhas e envios

Como marketing, quero o histórico de campanhas e envios no CRM novo, para consultar resultados anteriores.

#### AC-261 — Campanhas e envios migram ligados e com o status original

- **Dado** campanhas com envios ENVIADO, ERRO e CLICADO
- **Quando** o ETL roda
- **Então** cada envio fica ligado à sua campanha, com nome, e-mail e status preservados
- **E** a quantidade de envios migrados é igual à contada na origem

#### AC-262 — Campanha que estava processando nunca dispara envios depois da migração

- **Dado** uma campanha com status PROCESSANDO no legado
- **Quando** o ETL roda e o disparador do CRM novo trabalha
- **Então** nenhum e-mail dessa campanha é reenviado
- **E** a campanha migra como FINALIZADA e nenhum envio fica PENDENTE ou RASCUNHO

### US-072 — Migrar as mensagens de WhatsApp

Como atendente, quero o histórico de conversas no CRM novo, para não perder o contexto dos leads.

#### AC-263 — Mensagens migram com direção, número, texto e horário

- **Dado** 1.572 mensagens no legado
- **Quando** o ETL roda
- **Então** o CRM novo tem as mesmas mensagens, com direção, número, texto, status e horário originais

#### AC-264 — Mensagem sem lead correspondente migra sem vínculo e é reportada

- **Dado** mensagens sem `lead_id` ou com `lead_id` que não existe entre os leads migrados
- **Quando** o ETL roda
- **Então** elas migram sem vínculo com lead
- **E** o relatório informa quantas ficaram sem vínculo

### US-073 — Migrar as configurações de cada empresa

Como administrador, quero as configurações de integração de cada empresa no CRM novo, para não recadastrar tudo.

#### AC-265 — Configurações migram para o formato novo

- **Dado** configurações em texto no legado (ids de planilha, instância da Evolution, remetente, chaves de integração)
- **Quando** o ETL roda
- **Então** cada configuração existe na mesma empresa, com a mesma chave e o valor convertido para o formato novo

#### AC-266 — Segredo nunca aparece em saída do ETL

- **Dado** configurações que contêm chaves secretas
- **Quando** o ETL roda, inclusive em simulação, e gera relatório e log
- **Então** nenhum valor secreto aparece no relatório, no log nem no resumo
- **E** os segredos aparecem mascarados

### US-074 — Rodar o ETL com segurança, quantas vezes for preciso

Como responsável pelo cutover, quero poder ensaiar e repetir o ETL sem risco, para chegar ao dia da virada com contagens batendo.

#### AC-267 — Rodar de novo não duplica nada

- **Dado** um ETL que já rodou com sucesso
- **Quando** ele roda uma segunda vez sobre os mesmos dados
- **Então** nenhuma linha nova é criada e nenhuma existente é duplicada

#### AC-268 — A simulação não grava nada

- **Dado** o ETL em modo simulação (dry-run)
- **Quando** ele roda
- **Então** o banco de destino continua idêntico
- **E** o relatório diz o que seria criado, ignorado e enviado para revisão

#### AC-269 — O relatório confere as contagens com a origem

- **Dado** uma execução concluída
- **Quando** o relatório é gerado
- **Então** cada entidade mostra lidas, criadas, ignoradas e em revisão
- **E** a conta fecha: lidas = criadas + ignoradas + em revisão

#### AC-270 — Falha no meio não deixa migração pela metade

- **Dado** uma execução que falha na metade
- **Quando** o erro acontece
- **Então** nada do que foi gravado nessa execução permanece no destino

#### AC-271 — Cada dado migrado fica na empresa de origem

- **Dado** dados de duas empresas diferentes
- **Quando** o ETL roda
- **Então** todo registro migrado pertence à mesma empresa que tinha na origem, sem mistura

## Fora de escopo

- Google Sheets e Supabase da LP (features seguintes da fase 3).
- Tabelas `grupos`, `listas_contatos` e `contatos` (vazias no legado).
- Módulos de menu dos usuários (`modulos`): o RBAC novo é por papel.
- Migração de senhas (todos redefinem, Q11 do TDD).
- Ensaios em staging, card de teste E2E e o cutover em si.
- Vincular mensagens a leads vindos do Sheets (depende da feature do Sheets).

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-081 | Mapa de papéis: ADMIN→GERENTE, COMERCIAL e MARKETING→ATENDENTE; super admin→MASTER nas duas empresas (Q-028) | confirmada | Confirmado pelo usuário em 19/10 |
| ASM-082 | "Desqualificado"→Perdido com o motivo novo "Desqualificado (migração)" e "Em contato"→revisão manual (conforme RFC-001 §6.8). O usuário escolheu o motivo novo mesmo com o RFC prevendo "Sem perfil/fit" | confirmada | Decidido em 19/10; diverge do RFC neste motivo |
| ASM-083 | Os segredos de `empresa_configuracoes` são copiados como estão (decisão do usuário, contra a recomendação), com saída sempre mascarada | confirmada | Decidido em 19/10; risco registrado |
| ASM-084 | O histórico de campanhas, envios e mensagens migra por completo | confirmada | Decidido em 19/10 |
| ASM-085 | Telefones sem código de país são brasileiros (+55) | confirmada | Confirmado pelo usuário em 19/10 |
| ASM-086 | A contagem real de envios é 5.101 (a de 6.110 veio de estimativa do Postgres) | confirmada | Usuário confirmou 5.101 em 19/10; o relatório do ETL ainda confere a contagem |
| ASM-087 | O ETL lê o Supabase por conexão direta somente leitura (credencial só em variável de ambiente) e nunca altera a origem | confirmada | Decidido em 19/10 (Q-027) |

## Perguntas em aberto

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-027 | Como o ETL lê o Supabase: conexão direta somente leitura ou arquivo exportado (JSON/CSV)? | respondida | Conexão direta somente leitura |
| Q-028 | Os 2 super admins viram MASTER nas duas empresas ou só na empresa deles? | respondida | MASTER nas duas empresas |
| Q-029 | Como o disparador do CRM novo identifica campanha encerrada (qual status é "não retomável")? | respondida | O disparador só consome envio PENDENTE; FINALIZADA é o status final (`src/repositories/campanhas.ts:290-306`). No legado não há envio PENDENTE |
| Q-030 | As 7 mensagens com `lead_id` inexistente e as 1.565 sem `lead_id` pertencem a leads do Sheets? | respondida | O `lead_id` do legado é posicional e não confiável; o vínculo será feito pelo telefone na feature do Sheets (fase3-etl-sheets, AC-285) |

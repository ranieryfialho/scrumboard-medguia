# Inventário de telas do CRM MedGuia (para desenhar no Stitch)

> Uma rota por tela, sem abas internas: o que hoje é aba do legado (`/`) vira rota.
> Modais e painéis estão listados à parte (§ 4): são desenhados como sobreposição, sem rota.
> Fonte: especificações em `.spec/features/*`, componentes em `src/components/*` e APIs em `src/app/api/*`.

## Contexto para o Stitch (cole antes das telas)

- Produto: CRM B2B de vendas da MedGuia (clínicas e consultórios). Pipeline de 15 etapas, cadência de 18 toques, WhatsApp, mala direta e indicadores.
- Idioma da interface: português do Brasil. Uso diário em desktop, com versão mobile para a fila de tarefas e o WhatsApp.
- Papéis: **MASTER** (tudo), **GERENTE** (tudo, menos administração de empresas) e **ATENDENTE** (pipeline, tarefas e conversas). **Super admin** troca de empresa (multiempresa).
- Estados que toda tela precisa ter desenhados: carregando, vazio, erro e sem permissão.

## 1. Acesso (públicas, sem menu)

| # | Rota | Para que serve | Conteúdo principal | Ações |
|---|---|---|---|---|
| 1 | `/login` | Entrar (US-014) | e-mail, senha, mensagem de erro genérica, aviso de bloqueio por excesso de tentativas (5 em 15 min) | Entrar, "Esqueci minha senha" |
| 2 | `/esqueci-senha` | Pedir link de redefinição (US-017) | campo de e-mail, confirmação "se o e-mail existir, enviamos o link" | Enviar link, voltar ao login |
| 3 | `/redefinir-senha/[token]` | Definir nova senha pelo link (US-017) | nova senha, confirmação, regras da senha, estado de link expirado/inválido | Salvar senha |
| 4 | `/convite/[token]` | Aceitar convite e criar a senha (US-016) | nome da empresa e papel convidados, senha e confirmação, estado de convite expirado/usado | Ativar conta |
| 5 | `/sem-acesso` | Sessão expirada ou sem permissão (403) | mensagem clara e caminho de volta | Entrar de novo |

## 2. Casca do sistema (layout de todas as telas logadas)

Não é uma rota, mas precisa ser desenhada primeiro, porque envolve as telas do item 3.

- **Menu lateral**: expandido, recolhido (só ícones) e versão mobile com gaveta. Categorias: Operação, Análises, Comunicação, Administração. Itens são ocultados por papel (ex.: Indicadores só para GERENTE e MASTER).
- **Distintivos no menu**: contador de mensagens de WhatsApp não lidas e indicador de "tempo real conectado".
- **Topo**: título da tela, ações da tela, menu do usuário (nome, papel, sair).
- **Seletor de empresa** (só super admin, US-019): lista de empresas e a empresa ativa.

## 3. Telas logadas

### Operação

| # | Rota | Para que serve | Conteúdo principal | Ações |
|---|---|---|---|---|
| 6 | `/pipeline` | Quadro do funil (US-029) | 15 colunas (etapas), cards com nome do lead, responsável, valor, próxima ação, badge de atraso; contagem por coluna; filtros (busca, responsável, origem, período) | Arrastar para mover (US-031), novo card, "Iniciar cadência", atualizar |
| 7 | `/pipeline/lista` | Mesmo funil em tabela | colunas: lead, etapa, responsável, valor, próxima ação, origem, criado em; ordenação e filtros | Abrir card, mover, exportar |
| 8 | `/pipeline/arquivados` | Cards em etapa final (Perdido e Ganho) | duas listas ou filtros, motivo de perda, valor ganho, data de fechamento | Abrir card, reabrir (se permitido) |
| 9 | `/pipeline/[id]` | Detalhe do card, aba "Resumo" (US-033) | dados do lead (nome, telefone principal, e-mail, origem), etapa atual, responsável, valor, motivo, próxima ação, telefones extras (US-047), linha do tempo de eventos, atalho de etapa | Mover etapa, editar campos, adicionar telefone |
| 10 | `/pipeline/[id]/cadencia` | Cadência do card (US-053 a US-055) | 18 toques em 3 dias × manhã/tarde, canal (telefone/WhatsApp), tipo (ligação/mensagem/breakup), resultado de cada toque, barra de progresso | Iniciar cadência, concluir toque, registrar resultado |
| 11 | `/pipeline/[id]/conversa` | WhatsApp do lead (US-043, US-045) | histórico de mensagens (enviada/recebida), status, seletor entre os telefones do lead | Enviar mensagem, trocar de telefone |
| 12 | `/pipeline/[id]/anexos` | Prints e PDFs do card (US-034 a US-036) | lista com miniatura, nome, tipo, data, quem enviou, marcação de "evidência" | Enviar arquivo, abrir (link de curta duração), usar como evidência |
| 13 | `/tarefas` | Fila do turno atual (US-056, US-057, US-060) | bloco do turno (3 toques), cada item com lead, canal, tipo, "toque N de 18"; atualiza em tempo real; versão mobile | Concluir toque, abrir card |
| 14 | `/tarefas/atrasadas` | Toques vencidos (US-058) | lista ordenada por atraso, com o tempo de atraso | Concluir, abrir card |
| 15 | `/agenda` | Reuniões marcadas (existe `api/agenda`; confirmar) | calendário com reuniões, lead, horário, status (agendada, realizada, no-show) | Agendar, remarcar, marcar no-show |

### Comunicação

| # | Rota | Para que serve | Conteúdo principal | Ações |
|---|---|---|---|---|
| 16 | `/whatsapp` | Caixa de entrada (US-046) | lista de conversas com não lidas em destaque, busca, painel da conversa aberta | Responder, marcar como lida |
| 17 | `/whatsapp/nova` | Mensagem para número que não é lead (US-044) | número, mensagem, aviso de que não vira card | Enviar |
| 18 | `/whatsapp/conexao` | Estado da conexão e QR code (US-050, US-051) | status (conectado, desconectado, aguardando leitura), QR code com atualização | Gerar QR, reconectar |
| 19 | `/whatsapp/configuracao` | Configuração da instância (US-048, US-049) | URL da Evolution, nome da instância, chave (mascarada), URL do webhook e teste do webhook | Salvar, testar |
| 20 | `/campanhas` | Mala direta, lista (US-066) | campanhas com status (rascunho, enviando, finalizada), totais de envio, abertura e clique | Nova campanha, abrir, excluir |
| 21 | `/campanhas/nova` | Criar e editar rascunho (US-064) | nome, assunto, corpo do e-mail, seleção de destinatários (filtros por etapa, origem, tags), prévia | Salvar rascunho, iniciar envio |
| 22 | `/campanhas/[id]` | Detalhe e acompanhamento (US-065 a US-067) | envios por destinatário (enviado, falhou, aberto, clicado), totais, erros | Reenviar falhas, finalizar, excluir |

### Análises

| # | Rota | Para que serve | Conteúdo principal | Ações |
|---|---|---|---|---|
| 23 | `/indicadores` | Funil comercial (US-061 a US-063) | 7 indicadores: conexão, cumprimento da régua de 18 toques, agendamento, no-show, proposta, ativação no trial, conversão (valor, base e "sem dados"); filtros por período e responsável | Filtrar |
| 24 | `/relatorios` | Marketing e Tráfego (hoje existe) | origem dos leads, custo e conversão por canal, gráficos por período | Filtrar, exportar |
| 25 | `/relatorios-comerciais` | Comercial e Vendas (hoje existe) | desempenho por responsável, valor em proposta e ganho, ciclo médio, gráficos | Filtrar, exportar |

### Administração

| # | Rota | Para que serve | Conteúdo principal | Ações |
|---|---|---|---|---|
| 26 | `/equipe` | Equipe e acessos (US-015) | usuários da empresa com papel, status (ativo, convite pendente), último acesso | Convidar, trocar papel, desativar, reenviar convite |
| 27 | `/equipe/convidar` | Convidar usuário (US-015) | e-mail, nome, papel, confirmação do envio | Enviar convite |
| 28 | `/configuracoes/motivos-perda` | Motivos de perda (existe `api/motivos-perda`) | lista com ativo/inativo e marca "sistêmico" (não editável) | Criar, desativar |
| 29 | `/admin/empresas` | Empresas (só super admin) | lista com status e nº de usuários | Nova empresa, abrir |
| 30 | `/admin/empresas/nova` | Criar empresa | nome, identificador (slug), responsável inicial | Criar |
| 31 | `/admin/empresas/[id]` | Editar empresa | dados, ativo/inativo, usuários da empresa | Salvar, desativar |

## 4. Modais e painéis (sem rota própria)

| Modal | Onde aparece | O que mostra |
|---|---|---|
| Novo card | `/pipeline`, `/pipeline/lista` | nome, telefone, e-mail, origem, responsável; cai em "Entrada de leads" (US-030) |
| Dado que falta antes de mover (US-032) | ao mover o card | pede o campo exigido pela etapa de destino: valor (Proposta), próxima ação (Follow, Proposta, Teste, Negociação), motivo (Perdido), evidência (Reunião realizada) |
| Agendar reunião | detalhe do card e `/agenda` | data, hora, duração, participante, link da reunião |
| Fechamento (ganho ou perdido) | detalhe do card | valor e data no ganho; motivo de perda e observação no perdido |
| Erro de movimentação | ao mover | mensagem clara: transição não permitida, sem permissão, card alterado por outra pessoa (conflito) |
| Adicionar telefone | detalhe do card | número e rótulo (recepção, sócio, financeiro) |
| Confirmar exclusão | campanhas, equipe, empresas | texto de confirmação e ação destrutiva destacada |

## 5. Pontos a decidir antes de desenhar

1. **Dashboard do legado (`/`)**: mostra KPIs de leads, gráfico por especialidade e calendário. O CRM novo tem `/indicadores`. Fundir os dois em uma tela ou manter o dashboard separado?
2. **`/agenda` (15)**: a API existe, mas não achei tela nem critério de aceite. Confirmar se entra.
3. **Saúde do sistema** (`/admin/saude`): o worker e o espelho do Sheets têm indicador de atraso, mas sem tela. Entra ou fica só como API?
4. **Perfil do usuário** (trocar a própria senha, nome): não está em nenhuma especificação. Entra?

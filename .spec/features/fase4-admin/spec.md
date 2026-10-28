# Spec: Fase 4 — Administração: equipe, convites, motivos de perda e empresas (telas 26 a 31)

> feature: fase4-admin
> status: rascunho

<!--
  Como ler este arquivo (o formato é verificado por `onp-spec audit`):
  - US-xxx = história de usuário · AC-xxx = critério de aceite
    ASM-xxx = suposição · Q-xxx = pergunta em aberto
    São códigos de rastreio: ligam a especificação às tarefas e aos testes.
  - Toda história de usuário precisa de pelo menos um critério de aceite.
  - Todo critério de aceite precisa de Dado/Quando/Então completos.
  - Os códigos são únicos no projeto inteiro (nunca reutilize um número).
  - Suposições e Perguntas em aberto são OBRIGATÓRIAS: se não há nenhuma,
    escreva "Nenhuma." — mas desconfie: quase toda feature esconde uma.
-->

## Contexto

Última fase do roteiro que coloca o protótipo do Stitch
(`docs/ui/stitch_medcrm_interface_design/`) no produto. Esta feature entrega as
**telas 26 a 31 do inventário** (`docs/ui/inventario-telas.md`): a **equipe e
acessos** (`/equipe`), o **convite de usuário** (`/equipe/convidar`), os **motivos
de perda** (`/configuracoes/motivos-perda`), a **lista de empresas**
(`/admin/empresas`), a **nova empresa** (`/admin/empresas/nova`) e a **edição de
empresa** (`/admin/empresas/[id]`). Os quatro itens já estão no grupo "Administração"
do menu (Equipe e Motivos de Perda para GERENTE e MASTER; Empresas só para o super
admin).

Situação hoje (conferida no código em 28/10):

- As seis rotas **não existem** (404 a partir do menu).
- As rotas de administração que existem (`/api/usuarios`, `/api/empresas`,
  `/api/empresas/[id]`) são do sistema **antigo, em Supabase**: não usam a sessão nem
  o banco do CRM novo. Estas telas não podem usá-las.
- No CRM novo existem as **peças**: o vínculo usuário–empresa com papel e ativo
  (`empresas_usuarios`), o convite com token de uso único e prazo de 24 h
  (`convidarUsuario`, regra: GERENTE só convida ATENDENTE; MASTER e super admin convidam
  qualquer papel), a página que aceita o convite (`/convite/[token]`), o envio de e-mail
  pelo Resend, a troca de empresa ativa pelo super admin (`/api/empresa-ativa`) e as
  sessões (`sessoes`, com a data de cada login). **Não existem** as rotas que listam a
  equipe, convidam, trocam o papel, desativam, reenviam convite, criam ou editam empresa,
  nem o e-mail de convite.
- Uma empresa marcada como inativa **hoje continua acessível**: a resolução da sessão só
  confere o usuário e o vínculo (`resolverContextoTenant`), não a empresa.
- A tabela `motivos_perda` é **global** (sem `empresa_id`): todos os tenants compartilham
  o mesmo catálogo.
- O CRM não tem: plano, assentos contratados, CNPJ, endereço, 2FA, IP, departamento,
  telefone do usuário, instâncias de WhatsApp por empresa, pipeline consolidado entre
  empresas. O que o protótipo mostra com isso **não aparece**.

Regras herdadas: a marcação e as classes do `code.html` de cada tela são a referência;
**blocos que mostram dado inexistente no sistema são removidos** e **ações sem backend
aparecem visíveis e marcadas "em breve"**. Lições das features anteriores: critérios de
tela dizem o que a tela mostra; todo item do menu aponta para uma página que existe (e um
teste confere); antes da PR, a suíte inteira passa, não só os critérios da feature; a
prova (`verify`) é gerada no código final e commitada junto.

## Histórias

### US-137 — Gerir a equipe e os acessos (tela 26)

Como gerente ou master, quero ver quem está na minha empresa, com papel e situação, e
trocar papel, desativar e reenviar convites, para manter os acessos em dia.

#### AC-577 — A tela abre dentro da casca, só para gerente e master

- **Dado** um usuário com sessão
- **Quando** ele abre `/equipe` (ou clica em "Equipe" no menu)
- **Então** vê o menu e o topo da casca com "Equipe" marcado e o título "Gestão da Equipe e Acessos"; sem sessão vai ao login; o ATENDENTE continua sem o grupo "Administração" no menu e sem acesso à rota nem à API (regra da casca)

#### AC-578 — O servidor lista a equipe com filtros, busca e paginação, só da empresa da sessão

- **Dado** usuários de duas empresas, com papéis e situações diferentes
- **Quando** a tela pede `GET /api/equipe?papel=&status=&busca=&pagina=&porPagina=`
- **Então** voltam só os vínculos da empresa da sessão, ordenados por nome, cada um com `usuarioId`, `nome`, `email`, `papel`, `status` e `ultimoAcesso`; `papel` aceita ATENDENTE, GERENTE e MASTER, `status` aceita `ativo`, `pendente` e `inativo`, `busca` procura no nome e no e-mail, com `pagina` e `porPagina` a resposta traz o `total` filtrado e sem eles devolve todos; a resposta traz também `resumo` com o total e a quantidade de cada situação (sem filtros); valor inválido é 400, sem sessão 401 e ATENDENTE 403

#### AC-579 — A situação e o último acesso são derivados dos dados que existem

- **Dado** um vínculo ativo de quem já definiu a senha, um vínculo de quem foi convidado e ainda não definiu, e um vínculo desativado
- **Quando** a lista é montada
- **Então** o primeiro é `ativo`, o segundo é `pendente`, o terceiro é `inativo` (vínculo ou usuário desativado, que vale mais que pendente), e `ultimoAcesso` é a data do login mais recente do usuário (`null` para quem nunca entrou)

#### AC-580 — Os quatro cartões do topo vêm do resumo

- **Dado** o resumo carregado
- **Quando** os cartões são renderizados
- **Então** mostram "Total de colaboradores", "Usuários ativos", "Convites pendentes" e "Inativos", com as quantidades reais; "assentos contratados", "login médio" e "conformidade LGPD e 2FA" do protótipo **não aparecem** (sem dado)

#### AC-581 — A tabela mostra cada pessoa com papel, situação e último acesso

- **Dado** a lista de pessoas
- **Quando** a tabela é renderizada e o usuário usa a busca, "Todos os Papéis", "Todos os Status", "Limpar" ou troca de página
- **Então** cada linha mostra iniciais, nome, e-mail, o selo do papel (MASTER, GERENTE, ATENDENTE), o selo da situação (Ativo, Pendente, Inativo) e o último acesso ("Nunca acessou" para pendente, "Há N min/h/dias" ou a data); a tela pede ao servidor só o recorte (10 por página) e mostra "Exibindo N a M de T colaboradores"; sem resultado diz "Nenhum colaborador encontrado"; "squad e função", segurança 2FA e IP do protótipo **não aparecem**

#### AC-582 — Trocar o papel (só master)

- **Dado** a equipe da empresa e um MASTER (ou super admin)
- **Quando** ele escolhe outro papel para uma pessoa (`PATCH /api/equipe/[usuarioId]` com `{ "papel": ... }`)
- **Então** o vínculo é atualizado e a lista relida; GERENTE recebe 403 e a tela nem mostra a troca; ninguém troca o próprio papel (422 `NAO_PODE_ALTERAR_A_SI`), a empresa nunca fica sem nenhum MASTER ativo (422 `ULTIMO_MASTER`), pessoa de outra empresa ou inexistente é 404 `COLABORADOR_NAO_ENCONTRADO`, e papel inválido é 400

#### AC-583 — Desativar e reativar (só master)

- **Dado** a equipe da empresa e um MASTER (ou super admin)
- **Quando** ele desativa ou reativa uma pessoa (`PATCH /api/equipe/[usuarioId]` com `{ "ativo": false|true }`), depois de confirmar na tela com o nome
- **Então** o vínculo daquela empresa fica inativo (ou volta a ativo) e a pessoa desativada não consegue mais usar a sessão nela; as mesmas recusas do AC-582 valem (a si mesmo, último MASTER, outra empresa); o histórico dela (cards, mensagens) não é apagado

#### AC-584 — Reenviar o convite de quem ainda não entrou

- **Dado** uma pessoa com situação "Pendente"
- **Quando** o MASTER ou GERENTE usa "Reenviar convite" (`POST /api/equipe/[usuarioId]/reenviar-convite`)
- **Então** nasce um token novo (o antigo deixa de valer), o e-mail de convite é enviado e a resposta traz `emailEnviado` e o link; quem não está pendente é 422 `CONVITE_NAO_PENDENTE`; GERENTE só reenvia para ATENDENTE (403 nos demais); outra empresa é 404

#### AC-585 — Itens do protótipo sem backend aparecem "em breve" ou não aparecem

- **Dado** a tela da equipe
- **Quando** o usuário olha "Políticas & Perfis", "Exportar Auditoria (CSV)", "Todas as Frentes Comerciais", "Logs de Auditoria" e "Configurar IP Allowlist & Sessão"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; "Convidar Usuário" leva a `/equipe/convidar`; a seleção em massa, o bloco de políticas LGPD e os selos "Políticas LGPD vigentes" e "Auditoria criptográfica ativa" **não aparecem** (sem dado)

### US-138 — Convidar um novo usuário (tela 27)

Como gerente ou master, quero convidar uma pessoa por e-mail com o papel certo, para ela
criar a própria senha e entrar.

#### AC-586 — A tela abre dentro da casca com o formulário e a volta

- **Dado** um usuário com sessão que pode convidar
- **Quando** ele abre `/equipe/convidar`
- **Então** vê o título "Convidar Novo Usuário para a Equipe", o botão "Voltar para Gestão da Equipe" (`/equipe`), "Cancelar" (volta à lista) e as seções de dados e de papel; sem sessão vai ao login

#### AC-587 — O servidor cria o convite, envia o e-mail e devolve o link

- **Dado** um MASTER (ou GERENTE convidando um ATENDENTE) e um e-mail novo
- **Quando** a tela chama `POST /api/equipe/convites` com `{ email, nome, papel }`
- **Então** é criado o vínculo na empresa da sessão e um token de uso único de 24 horas (a regra de `convidarUsuario`), o nome informado é gravado no usuário novo, o e-mail de convite (marcado MedCRM, com o link `/convite/<token>`) é enviado, e a resposta é 201 com `usuarioId`, `papel`, `expiraEm`, `emailEnviado` e `linkConvite`; se o envio do e-mail falhar (remetente não configurado ou erro), o convite continua criado e `emailEnviado` é `false`; a `empresaId` nunca vem do corpo

#### AC-588 — O servidor recusa o que não pode

- **Dado** um pedido de convite
- **Quando** o e-mail é inválido ou o nome está vazio, o papel é inválido, o GERENTE pede um papel que não é ATENDENTE, ou a pessoa já está ativa na empresa
- **Então** a resposta é, respectivamente, 400, 400, 403 `SEM_PERMISSAO` e 409 `JA_E_COLABORADOR`, sem criar vínculo nem token; sem sessão é 401 e ATENDENTE é 403; e-mail de quem já está desativado na empresa reativa o vínculo (e reenvia o convite se a pessoa ainda não definiu a senha) em vez de duplicar

#### AC-589 — O formulário valida, mostra a prévia e a matriz de acessos do papel

- **Dado** o formulário "Dados Cadastrais do Colaborador" e "Definição de Papel e Permissões"
- **Quando** o usuário preenche nome e e-mail e escolhe ATENDENTE, GERENTE ou MASTER (para o GERENTE só ATENDENTE está disponível)
- **Então** "Enviar Convite por E-mail" fica desabilitado sem nome, e-mail válido e papel; a "Prévia do card de usuário" mostra iniciais, nome, e-mail, o papel e "Pendente"; a "Matriz de Acessos" lista o que o papel pode e o que não pode, de acordo com as regras de acesso do sistema (por exemplo, o ATENDENTE não acessa análises, equipe nem empresas); a validade mostra "24 horas"

#### AC-590 — O resultado do convite mostra o link e avisa quando o e-mail não saiu

- **Dado** o envio do convite pela tela
- **Quando** a API responde 201, 409, 403 ou falha de rede
- **Então** em 201 a tela mostra "Convite criado para <e-mail>" com o link copiável e, se `emailEnviado` for falso, o aviso "O e-mail não pôde ser enviado: copie o link e envie manualmente"; nos erros mostra o motivo em português dentro da tela, sem perder o que foi digitado; o botão fica desabilitado enquanto envia

#### AC-591 — Itens do protótipo sem backend aparecem "em breve"

- **Dado** a tela de convite
- **Quando** o usuário olha "WhatsApp Corporativo", "Departamento / Squad", "Exigir 2FA no primeiro acesso", "Atribuir leads automaticamente", "Validade do token", "Mensagem personalizada de boas-vindas" e "Restam N licenças"
- **Então** os cinco primeiros aparecem visíveis, marcados "em breve", sem efeito; "licenças" e o bloco "Garantias de Governança Médica (US-016)" **não aparecem** (sem dado)

### US-139 — Consultar e manter os motivos de perda (tela 28)

Como gerente ou master, quero ver o catálogo de motivos de perda e quanto cada um pesa,
para entender por que perdemos negócios.

#### AC-592 — A tela abre dentro da casca

- **Dado** um usuário com sessão que pode ver administração
- **Quando** ele abre `/configuracoes/motivos-perda` (ou clica em "Motivos de Perda" no menu)
- **Então** vê o item marcado e o título "Motivos de Perda & Churn Comercial"; sem sessão vai ao login; o ATENDENTE continua sem acesso (regra da casca)

#### AC-593 — O servidor lista todos os motivos com o uso na empresa da sessão

- **Dado** motivos sistêmicos e personalizados, ativos e inativos, e cards perdidos de duas empresas
- **Quando** a tela pede `GET /api/configuracoes/motivos-perda?tipo=&status=&busca=`
- **Então** voltam todos os motivos (inclusive os inativos), cada um com `id`, `nome`, `sistemico`, `ativo`, `usadoNoMes` e `usadoTotal` (cards da **empresa da sessão** hoje em "Perdido" com aquele motivo; o do mês é pela data do evento de ida para "Perdido") e `podeEditar` (verdadeiro só para o super admin e só para motivo personalizado); `tipo` aceita `sistemico` e `personalizado`, `status` aceita `ativo` e `inativo`, `busca` procura no nome; também vêm os totais do catálogo; valor inválido é 400, sem sessão 401 e ATENDENTE 403

#### AC-594 — Os indicadores do topo vêm do catálogo e das perdas do mês

- **Dado** o catálogo e as perdas do mês corrente
- **Quando** os cartões são renderizados
- **Então** mostram "Catálogo de motivos" (ativos, com quantos são sistêmicos e personalizados), "Perdas no mês" (quantidade de cards que foram para "Perdido" no mês) e "Principal motivo" (o de mais perdas, com a porcentagem do mês, ou traço sem perdas); "Impacto em pipeline", "vs mês anterior" e "Conformidade de fechamento" do protótipo **não aparecem** (sem dado)

#### AC-595 — A tabela mostra o motivo, a natureza, o uso e a situação

- **Dado** a lista de motivos
- **Quando** a tabela é renderizada e o usuário usa a busca, "Todos os Tipos", "Sistêmicos", "Personalizados", "Status: Todos" ou "Limpar"
- **Então** cada linha mostra o nome, o selo "Sistêmico" ou "Personalizado", "N no mês" e "Histórico: N cards", e o selo "Ativo" ou "Inativo"; o motivo sistêmico aparece com o cadeado e sem ações; sem resultado diz "Nenhum motivo encontrado"; descrição técnica, categoria e "Top 1" do protótipo **não aparecem** (o motivo só tem nome)

#### AC-596 — Criar e ativar/desativar um motivo personalizado (só super admin)

- **Dado** o catálogo global (ASM-201) e um super admin
- **Quando** ele usa "+ Novo Motivo de Perda" (`POST /api/configuracoes/motivos-perda` com `{ nome }`) ou "Desativar"/"Ativar" num motivo personalizado (`PATCH .../[id]` com `{ ativo }`)
- **Então** o motivo é criado como personalizado e ativo (nome de 3 a 80 caracteres, sem repetir outro, 409 `MOTIVO_JA_EXISTE`) ou muda de situação, e a lista é relida; motivo sistêmico não muda (422 `MOTIVO_SISTEMICO`); quem não é super admin recebe 403, e a tela nem mostra os botões de criar e desativar para ele

#### AC-597 — Itens do protótipo sem backend aparecem "em breve" ou não aparecem

- **Dado** a tela de motivos de perda
- **Quando** o usuário olha "Exportar Relatório de Churn (CSV)", "Ver Diretrizes", "Abrir Playbook" e as ações de ver e editar
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; "Distribuição por Categoria", "Ação de Retenção Recomendada" e "Governança Multi-Tenant" **não aparecem** (sem dado)

### US-140 — Ver as empresas da rede (tela 29)

Como super admin, quero ver todas as empresas, com situação e tamanho, e entrar em uma
delas, para administrar a rede.

#### AC-598 — A tela abre dentro da casca, só para o super admin

- **Dado** um usuário com sessão
- **Quando** o super admin abre `/admin/empresas` (ou clica em "Empresas" no menu)
- **Então** vê o item "Empresas" marcado e o título "Rede de Organizações & Franquias"; sem sessão vai ao login; GERENTE e MASTER que não são super admin não veem o item e não acessam a rota nem a API (regra da casca)

#### AC-599 — O servidor lista as empresas com a quantidade de pessoas

- **Dado** empresas ativas e inativas, com usuários ativos, pendentes e desativados
- **Quando** a tela pede `GET /api/admin/empresas?status=&busca=`
- **Então** voltam todas as empresas, da mais nova para a mais antiga, cada uma com `id`, `nome`, `slug`, `ativo`, `criadoEm`, `usuariosAtivos` e `usuariosTotal`, mais `resumo` (total de empresas, ativas e inativas e total de usuários ativos); `status` aceita `ativa` e `inativa`, `busca` procura no nome e no identificador; valor inválido é 400, sem sessão 401 e quem não é super admin é 403

#### AC-600 — Os cartões e a lista mostram o que existe

- **Dado** a lista carregada
- **Quando** a tela é renderizada e o usuário usa a busca, "Todos os Status" ou "Limpar"
- **Então** os cartões mostram "Empresas na rede" (com ativas e inativas) e "Usuários ativos"; cada linha mostra iniciais, nome, identificador (`tenant: <slug>`), selo "Ativa"/"Inativa" e "Atual" na empresa em que o super admin está, a quantidade de usuários e a data de criação, com os atalhos "Abrir" (`/admin/empresas/[id]`) e "Acessar"; "+ Nova Empresa / Clínica" leva a `/admin/empresas/nova`; CNPJ, plano, licenças, administrador, pipeline consolidado e instâncias de WhatsApp do protótipo **não aparecem** (sem dado)

#### AC-601 — "Acessar" troca a empresa ativa do super admin

- **Dado** a lista de empresas
- **Quando** o super admin usa "Acessar" numa empresa que não é a atual (ou escolhe a empresa em "Trocar de Empresa Ativa")
- **Então** a tela chama `POST /api/empresa-ativa` (a rota que já existe) com a empresa escolhida, a casca passa a mostrar essa empresa e a lista marca "Atual" nela; em caso de recusa mostra o motivo; "Acessar" na empresa atual fica desabilitado

#### AC-602 — Itens do protótipo sem backend aparecem "em breve" ou não aparecem

- **Dado** a tela de empresas
- **Quando** o usuário olha "Exportar Base (CSV)", "Todos os Planos" e os blocos de segregação lógica, webhooks e auditoria
- **Então** o primeiro e o filtro de planos aparecem "em breve"; os três blocos informativos **não aparecem**

### US-141 — Cadastrar uma nova empresa (tela 30)

Como super admin, quero criar uma empresa já com o administrador master convidado, para
a clínica começar a usar.

#### AC-603 — A tela abre dentro da casca, só para o super admin

- **Dado** um super admin com sessão
- **Quando** ele abre `/admin/empresas/nova`
- **Então** vê o título "Cadastrar Nova Empresa ou Filial", o botão "Voltar para Gestão de Empresas" (`/admin/empresas`), "Cancelar" e as seções de identificação e de administrador master; sem sessão vai ao login; quem não é super admin é barrado pela regra da casca

#### AC-604 — O servidor cria a empresa e convida o master

- **Dado** um super admin e um pedido válido
- **Quando** a tela chama `POST /api/admin/empresas` com `{ nome, slug, masterNome, masterEmail }`
- **Então** a empresa nasce ativa, e o master é convidado com o papel MASTER (token de uso único de 24 horas, nome gravado, e-mail enviado, como no AC-587); a resposta é 201 com `id`, `slug`, `masterUsuarioId`, `emailEnviado` e `linkConvite`; se o e-mail falhar, a empresa e o convite continuam criados com `emailEnviado: false`; tudo numa operação só (se o convite falhar, a empresa não fica criada)

#### AC-605 — O servidor recusa nome, identificador e e-mail inválidos

- **Dado** um pedido de criação de empresa
- **Quando** o nome tem menos de 3 caracteres, o identificador não tem de 3 a 40 letras minúsculas, números e hífens (sem começar ou terminar em hífen), o identificador já existe, ou o e-mail ou o nome do master são inválidos
- **Então** a resposta é 400 (com o campo), 409 `SLUG_EM_USO` no caso do identificador repetido, sem criar nada; quem não é super admin é 403 e sem sessão é 401

#### AC-606 — O formulário valida, mostra o resumo e o resultado

- **Dado** o formulário "Identificação Cadastral" e "Administrador Master Inicial"
- **Quando** o usuário preenche, usa "Criar e Provisionar Empresa" ou erra algum campo
- **Então** o identificador é sugerido a partir do nome (minúsculas, sem acento, com hífens) e pode ser ajustado, "Resumo do Provisionamento" mostra o endereço `app/<identificador>` e o master; os erros aparecem ao lado do campo; em 201 mostra "Empresa criada" com o link de convite copiável (e o aviso se o e-mail não saiu) e o atalho para a empresa; em 409 mostra "Esse identificador já está em uso"; o botão fica desabilitado enquanto envia

#### AC-607 — Itens do protótipo sem backend aparecem "em breve" ou não aparecem

- **Dado** a tela de nova empresa
- **Quando** o usuário olha "Razão social", "CNPJ", "Localização e Contato", "Plano de Assinatura & Cotas", "Assentos", "Especialidade médica", "Cargo" e "Celular do master"
- **Então** o plano e as cotas aparecem num bloco "em breve" (sem efeito) e os demais campos **não aparecem** (o sistema não guarda); os blocos "Conformidade CFM & LGPD" e "Manual Técnico" **não aparecem**

### US-142 — Editar e suspender uma empresa (tela 31)

Como super admin, quero ver os dados de uma empresa e suas pessoas, mudar o nome e
suspendê-la, para administrar a rede.

#### AC-608 — A tela abre dentro da casca com os dados da empresa

- **Dado** um super admin com sessão
- **Quando** ele abre `/admin/empresas/[id]` (por `GET /api/admin/empresas/[id]`)
- **Então** vê o nome, o selo "Ativa"/"Inativa", `tenant: <slug>` (somente leitura, "inalterável após a criação"), a data de criação, o botão "Voltar para Rede de Empresas", os cartões "Usuários ativos" e "Pendentes" e a lista de pessoas da empresa (nome, e-mail, papel e situação); empresa inexistente mostra "Empresa não encontrada" (404 da API); quem não é super admin é barrado pela regra da casca

#### AC-609 — Salvar o nome e a situação da empresa

- **Dado** um super admin na edição
- **Quando** ele muda o nome e usa "Salvar Alterações" (`PATCH /api/admin/empresas/[id]` com `{ nome }`), ou suspende e reativa (`{ ativo }`) depois de confirmar com o nome da empresa
- **Então** o nome (3 a 80 caracteres, 400 fora disso) e a situação são gravados, o identificador nunca muda, e a empresa em que o próprio super admin está não pode ser suspensa (422 `EMPRESA_ATUAL`); empresa inexistente é 404; quem não é super admin é 403

#### AC-610 — Empresa suspensa não dá mais acesso

- **Dado** uma empresa marcada como inativa, com usuários ativos
- **Quando** um desses usuários (que não é super admin) tenta usar a sessão ou entrar
- **Então** a sessão é recusada como inválida (401 nas rotas, redirecionamento ao login nas telas) enquanto a empresa estiver inativa, e volta a funcionar quando ela é reativada; as demais empresas não são afetadas; os dados da empresa não são apagados

#### AC-611 — A edição mostra e leva às pessoas da empresa

- **Dado** a lista de pessoas da empresa aberta
- **Quando** ela é renderizada
- **Então** cada pessoa mostra iniciais, nome, e-mail, o selo do papel e o selo da situação (Ativo, Pendente ou Inativo), e "Acessar esta empresa" usa a troca de empresa ativa (AC-601); sem pessoas mostra "Nenhuma pessoa nesta empresa"

#### AC-612 — Itens do protótipo sem backend aparecem "em breve" ou não aparecem

- **Dado** a tela de edição
- **Quando** o usuário olha "Impersonate / Acessar como Master", "Alterar Cota", as abas de integrações e logs, as políticas de governança e "Desativar e Arquivar Tenant"
- **Então** aparecem visíveis, marcados "em breve", sem disparar ação; plano, assentos, razão social, CNPJ, localização, volume de pipeline, fechamentos, mensagens por dia e infraestrutura **não aparecem** (sem dado)

### US-143 — Navegar pela administração sem 404 e com estados de verdade

Como usuário, quero que todo item de Administração do menu abra uma tela de verdade,
com carregando, vazio e erro.

#### AC-613 — Os itens do menu e as seis rotas apontam para páginas que existem

- **Dado** os itens "Equipe", "Motivos de Perda" e "Empresas" do menu lateral
- **Quando** o teste lê os `href` e as páginas
- **Então** existem as páginas do Next dentro de `src/app/(app)` para `/equipe`, `/equipe/convidar`, `/configuracoes/motivos-perda`, `/admin/empresas`, `/admin/empresas/nova` e `/admin/empresas/[id]`; o grupo "Administração" é visível a GERENTE e MASTER (com "Empresas" só para o super admin) e escondido do ATENDENTE; a casca marca o item certo em cada rota; as rotas não são públicas

#### AC-614 — Cada tela tem estado de carregamento, vazio e erro

- **Dado** qualquer das telas de lista e de detalhe
- **Quando** os dados estão carregando, voltam vazios ou a API falha
- **Então** a tela mostra, respectivamente, um esqueleto de carregamento, uma mensagem de vazio com o próximo passo e uma mensagem de erro com "Tentar de novo" que não apaga o que já estava na tela

## Fora de escopo

- **Plano, assentos, cotas, razão social, CNPJ, endereço, especialidade, telefone e departamento:** o CRM não guarda; "em breve" ou removidos (Q-059).
- **2FA, IP allowlist, sessões, políticas LGPD, logs e trilha de auditoria:** não existem; "em breve" ou removidos.
- **Impersonate** (entrar como outro usuário), **arquivar tenant**, **integrações e instâncias de WhatsApp por empresa** e **pipeline consolidado da rede:** sem backend; "em breve" ou removidos.
- **Exportar** (equipe, empresas, churn): sem backend; "em breve".
- **Editar nome, renomear ou excluir um motivo de perda, e categorias de motivo:** o motivo só tem nome e situação; só criar e ativar/desativar (Q-060).
- **Mudar o identificador (slug) de uma empresa**, **mover pessoa entre empresas** e **convidar para mais de uma empresa pela tela:** o modelo permite, mas fora desta fase.
- **Validade do convite diferente de 24 horas, mensagem de boas-vindas e atribuição automática de leads.**
- As rotas e telas antigas (`/api/usuarios`, `/api/empresas`, `/admin`, `src/components/usuarios-tab.tsx`) **ficam como estão**; as telas novas não as usam.

## Suposições

<!-- O que estamos ASSUMINDO sem confirmação. Status: aberta | confirmada | invalidada -->

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-200 | A situação de um colaborador é: `inativo` se o vínculo ou o usuário está desativado; senão `pendente` se o usuário ainda não definiu a senha (sem conta com senha); senão `ativo` | aberta | O convite não tem coluna própria de situação |
| ASM-201 | O catálogo de motivos de perda é global (todos os tenants compartilham); por isso só o super admin cria e desativa, e MASTER/GERENTE só consultam o catálogo e o uso na própria empresa | aberta | `motivos_perda` não tem `empresa_id`; separar por empresa exigiria migration (Q-060) |
| ASM-202 | Quem pode o quê na equipe: MASTER e super admin veem, convidam qualquer papel, trocam papel, desativam e reenviam; GERENTE vê, convida e reenvia convite só de ATENDENTE; ATENDENTE não acessa | aberta | Mantém a regra do convite (ASM-012) e a matriz de rotas (ASM-123) |
| ASM-203 | Ninguém altera o próprio papel nem se desativa, e a empresa sempre mantém pelo menos um MASTER ativo | aberta | Evita ficar sem administrador |
| ASM-204 | "Último acesso" = a data do login (sessão criada) mais recente do usuário; não distingue dispositivo | aberta | A sessão guarda a data de criação |
| ASM-205 | A validade do convite continua 24 horas (o protótipo diz 48 h) | aberta | É a regra decidida em Q-006 da fase1-auth-rbac |
| ASM-206 | Desativar é só do vínculo da empresa (`empresas_usuarios.ativo`); o usuário global só é desativado por outro caminho, fora desta fase | aberta | A pessoa pode ter vínculo em outra empresa |
| ASM-207 | Empresa inativa bloqueia a sessão de quem não é super admin: a resolução de sessão passa a exigir `empresas.ativo = true` no vínculo | aberta | Hoje o campo existe mas não é conferido |
| ASM-208 | O identificador (slug) da empresa tem de 3 a 40 caracteres entre letras minúsculas, números e hífens, sem hífen no começo ou no fim, e não muda depois de criado | aberta | O protótipo diz "inalterável após criação" |
| ASM-209 | O link de convite aparece na resposta da criação para quem convidou (MASTER, GERENTE ou super admin), porque o e-mail pode falhar; o token não é gravado em lugar nenhum além do que o convite já grava | aberta | Sem o link o convite se perderia se o Resend falhar |
| ASM-210 | O e-mail de convite usa o mesmo remetente e o mesmo transporte (Resend) do e-mail de redefinição de senha | aberta | `enviar.ts` já existe |

## Perguntas em aberto

<!-- O que ainda não sabemos. Status: aberta | respondida -->

| ID | Pergunta | Status | Resposta |
|---|---|---|---|
| Q-059 | A empresa vai guardar razão social, CNPJ, endereço, plano e número de assentos? O protótipo mostra tudo isso na criação e na edição; hoje só existem nome e identificador. Enquanto isso, esses campos não aparecem | aberta | — |
| Q-060 | Os motivos de perda devem ser por empresa (cada clínica com os seus) em vez de globais? Hoje o catálogo é compartilhado, então só o super admin cria ou desativa. Separar exige uma migration e uma decisão sobre o que acontece com os motivos atuais | aberta | — |

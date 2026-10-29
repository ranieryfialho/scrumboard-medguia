# Spec: Fase 5 — Dados da empresa: razão social, CNPJ, endereço, plano e assentos

> feature: fase5-empresa-dados
> status: rascunho

## Contexto

A empresa só tinha nome e identificador. O dono do produto decidiu (Q-059) que ela guarde **razão
social, CNPJ, endereço, plano e número de assentos**, e que o número de assentos seja uma **cota**:
o convite (e a reativação) de um colaborador respeita o limite. O super admin cadastra e edita esses
dados nas telas de empresas (`/admin/empresas/nova` e `/admin/empresas/[id]`).

## Histórias

### US-153 — Cadastrar e editar os dados da empresa

Como super admin, quero registrar razão social, CNPJ, endereço, plano e assentos de cada empresa, para
ter a rede cadastrada de verdade e controlar quantas pessoas cada uma pode ter.

#### AC-651 — Criar a empresa já com os dados

- **Dado** o formulário de nova empresa com nome, identificador, administrador master, razão social, CNPJ válido, plano e assentos, e um endereço completo
- **Quando** o super admin cria a empresa
- **Então** os dados ficam gravados (CNPJ só com dígitos, CEP com 8 dígitos, UF em maiúsculas) e o detalhe da empresa os devolve; razão social, CNPJ, plano e assentos são obrigatórios; o endereço é opcional, mas, se vier, exige CEP, logradouro, número, cidade e UF (complemento e bairro são livres)

#### AC-652 — Validações

- **Dado** um CNPJ com dígito verificador errado, um CNPJ já usado por outra empresa, um plano fora de Starter, Clínica e Enterprise, assentos fora de 1 a 9999, uma UF que não existe ou um CEP sem 8 dígitos
- **Quando** o super admin tenta criar ou editar
- **Então** é recusado sem gravar nada: 400 com o campo para formato e valor inválidos, 409 `CNPJ_EM_USO` para CNPJ repetido (aceita pontos, barra e traço ao digitar)

#### AC-653 — Editar os dados e a cota

- **Dado** uma empresa com 3 pessoas ativas ou com convite pendente
- **Quando** o super admin edita razão social, CNPJ, endereço, plano ou assentos (`PATCH`, junto com nome e situação que já existiam)
- **Então** as mudanças são gravadas; baixar os assentos para menos do que já está em uso é recusado com 409 `ASSENTOS_ABAIXO_DO_EM_USO`; o CNPJ continua único

#### AC-654 — Detalhe e lista mostram os dados

- **Dado** empresas com e sem os novos dados (as antigas não têm)
- **Quando** o super admin abre a lista e o detalhe
- **Então** a lista traz o plano e "N de M" assentos em uso (só "N" e "sem limite" quando não há cota), e o detalhe traz todos os campos, com vazio onde não foram informados

### US-154 — Respeitar a cota de assentos

Como dono da rede, quero que uma empresa não passe do número de assentos contratado.

#### AC-655 — Convidar além da cota é recusado

- **Dado** uma empresa com 5 assentos e 5 vínculos ativos (pessoas com acesso ou convite pendente)
- **Quando** o master ou o gerente convida mais uma pessoa
- **Então** a resposta é 409 `SEM_ASSENTOS`, nada é criado, e a tela mostra "A empresa atingiu o limite de assentos do plano"; desativar alguém libera um assento; empresa sem cota (assentos vazio) convida sem limite

#### AC-656 — Reativar também respeita a cota

- **Dado** uma empresa lotada e um colaborador desativado
- **Quando** alguém reativa essa pessoa (pela troca de situação ou convidando o e-mail de novo)
- **Então** a reativação é recusada com 409 `SEM_ASSENTOS` e a pessoa continua desativada

### US-155 — Telas de empresas com os novos dados

Como super admin, quero ver e digitar esses dados nas telas de empresas.

#### AC-657 — Nova empresa

- **Dado** a tela `/admin/empresas/nova`
- **Quando** o super admin a abre
- **Então** há campos para razão social, CNPJ, CEP, logradouro, número, complemento, bairro, cidade, UF, plano (Starter, Clínica ou Enterprise) e assentos, o erro de cada campo aparece junto dele, e o item "Plano e cotas de recursos (em breve)" deixa de existir

#### AC-658 — Editar empresa e lista

- **Dado** as telas `/admin/empresas/[id]` e `/admin/empresas`
- **Quando** o super admin as abre
- **Então** a edição mostra e salva os mesmos campos (o identificador continua fixo), "Alterar Cota (em breve)" vira o campo de assentos, e a lista mostra o plano e "N de M" assentos em cada linha

#### AC-659 — Equipe mostra os assentos

- **Dado** uma empresa com cota
- **Quando** o master ou o gerente abre a equipe
- **Então** vê "N de M assentos em uso" e, ao tentar convidar com a cota cheia, a mensagem em português da recusa

## Fora de escopo

- Consulta do CNPJ na Receita Federal e busca de endereço pelo CEP (só validação de formato e dígito).
- Cobrança, troca de plano com regras (o plano é só um rótulo; a cota é o campo de assentos), "Alterar Cota" por recurso (WhatsApp, e-mails) e planos personalizados.
- Telefone e e-mail institucionais, especialidade e demais campos do protótipo que o CRM não usa.
- Exibir razão social e CNPJ para quem não é super admin.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-228 | Os planos são os três do protótipo (Starter, Clínica, Enterprise), guardados como `starter`, `clinica` e `enterprise`; são só rótulos, sem regra própria | aberta | Se o plano precisar de regra (recursos liberados), vira outra feature |
| ASM-229 | Assentos em uso = vínculos `empresas_usuarios` ativos (inclui convite pendente, exclui desativado); assentos vazio = sem limite (empresas existentes continuam assim) | aberta | Convite pendente reserva o assento |
| ASM-230 | Empresas já existentes ficam com plano, assentos, razão social e CNPJ vazios; o super admin completa depois | aberta | Migration só acrescenta colunas |
| ASM-231 | CNPJ é guardado só com os 14 dígitos, validado pelos dígitos verificadores, e é único na rede (índice único parcial, ignora vazio) | aberta | — |
| ASM-232 | O endereço usa as colunas do protótipo (CEP, logradouro, número, complemento, bairro, cidade, UF); UF é uma das 27 siglas | aberta | — |
| ASM-233 | Quem edita os dados é só o super admin (como nome e situação hoje); o master vê apenas "N de M assentos" | aberta | Mantém a regra de ASM-201/ASM-202 |
| ASM-234 | A cota vale na criação do convite e na reativação; baixar o limite abaixo do uso é recusado, nunca desativa ninguém | aberta | — |

## Perguntas em aberto

Nenhuma.

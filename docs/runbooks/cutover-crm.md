# Runbook: Cutover do CRM novo para produção

> Objetivo: trocar o scrumboard legado (Supabase) pelo CRM novo na VPS, com o banco
> `crm_prod` migrado, as variáveis e os agendadores no lugar e uma conferência no fim.
>
> **Estado deste documento (29/10/2026):** escrito a partir do código (`drizzle/`,
> `docker-compose.yml`, `process.env.*`, rotas `/api/cron/*`) e dos runbooks
> [`provisionar-staging.md`](provisionar-staging.md) e
> [`restore-backup-crm.md`](restore-backup-crm.md). **Nada aqui foi executado em
> produção.** Ajuste o que a máquina real contradisser e registre aqui. O cutover só
> acontece com autorização expressa do dono do produto.

## 1. Onde estamos

- O container `scrumboard-medguia` que roda na VPS hoje é o **legado** (imagem local,
  Supabase). O `pg-master` **não tem `crm_prod`** ainda (medido em 16/10; confirmar).
- Todas as features do CRM novo (fases 0 a 5, as 31 telas e o WhatsApp em lote) estão na
  `main`. O workflow `deploy.yml` faria `docker compose up -d` com o mesmo
  `container_name: scrumboard-medguia`, **substituindo o legado de uma vez**. Por isso
  **não dispare o `deploy.yml` antes de seguir este roteiro.**
- A imagem do CRM é publicada no GHCR pelo `release.yml` só com a tag do **SHA do commit**
  (nunca `:latest`). Use o SHA da `main` no dia.

## 2. Antes de começar

| Item | Como conferir |
|---|---|
| Todas as PRs da fase 5 mergeadas (#47 a #54) e o `Release` da `main` verde | `gh pr list --state merged`, `gh run list --workflow release.yml` |
| Última migration em `drizzle/` é a `0021_whatsapp_lotes.sql` | `ls drizzle` |
| Acesso SSH root à VPS; código em `/root/crm-staging` (nunca em `~/scrumboard-medguia`, que é o legado) | — |
| Janela combinada com a operação (o legado sai do ar durante a troca) | — |
| Plano de volta lido (seção 9) | — |

**Faça um backup do cluster antes de qualquer passo:**

```bash
pg_dumpall -U postgres | gzip > /root/backups/pg-master-pre-cutover_$(date +%F_%H%M).sql.gz
```

## 3. Banco: `crm_prod` e as migrations

1. Se `crm_prod`, `crm_app` e `crm_migrator` ainda não existem, crie-os como no
   [`provisionar-staging.md`](provisionar-staging.md) (`infra/postgres/init/01-databases-and-roles.sql`).
2. Aplique **todos** os `.sql` de `drizzle/`, **em ordem**, com `psql` como `crm_migrator`,
   direto no `crm_prod`. **Não use `npm run db:migrate`:** o `_journal.json` só conhece
   4 das migrations (as demais são escritas à mão).

```bash
for f in drizzle/0*.sql; do
  psql "postgres://crm_migrator:...@pg-master:5432/crm_prod" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

O que cada migration das fases 4 e 5 faz (todas **só acrescentam**; nenhuma apaga dado):

| Migration | O que faz |
|---|---|
| `0012_cadencia_fila` | fila de tarefas da cadência |
| `0013_anexos_nome` | nome do arquivo do anexo |
| `0014_auditoria_exportacoes` | registro append-only das exportações de CSV (LGPD) |
| `0015_empresa_metas` | metas dos indicadores por empresa |
| `0016_investimento_midia` | investimento em mídia por empresa, mês e canal |
| `0017_transicao_cancelar_reuniao` | permite "Reunião agendada" → "Qualificado p/ reunião" no funil |
| `0018_empresa_dados` | razão social, CNPJ, endereço, plano e assentos na empresa (todos vazios nas existentes = sem limite) |
| `0019_motivos_perda_por_empresa` | dono do motivo de perda (os atuais ficam globais); troca o índice único de nome por dois parciais |
| `0020_whatsapp_lote_base` | consentimento do lead e templates de WhatsApp |
| `0021_whatsapp_lotes` | lotes e fila de envio do WhatsApp em lote |

**Conferência do banco** (como `crm_migrator`; os números vêm do estado de 29/10, ajuste se
alguma migration nova entrar):

```sql
SELECT count(*) FROM pipeline_etapas;                                  -- 15
SELECT count(*) FROM pipeline_transicoes WHERE etapa_origem_id = 8 AND etapa_destino_id = 6;  -- 1
SELECT count(*) FROM motivos_perda WHERE empresa_id IS NULL;           -- 8 (os do seed)
SELECT to_regclass('whatsapp_lotes'), to_regclass('whatsapp_templates'), to_regclass('empresa_metas'), to_regclass('investimento_midia');  -- nenhum NULL
```

Confirme também que `crm_app` consegue DML e **não** consegue DDL (como no staging).

## 4. Variáveis de ambiente (`.env` da VPS)

O `.env` é lido pelo app **e** pelo worker (`env_file: .env` no `docker-compose.yml`).

| Variável | Para quê | Obrigatória |
|---|---|---|
| `DATABASE_URL` | conexão do app (`crm_app`) com o `crm_prod` | sim |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | sessão e login | sim |
| `NEXT_PUBLIC_APP_URL` | links de convite e de redefinição de senha | sim |
| `ANEXOS_DIR` (`/data/anexos`, já no compose), `ANEXOS_SEGREDO` | evidências e anexos assinados | sim |
| `CRON_SEGREDO` | protege `/api/cron/cadencia` e `/api/cron/whatsapp-lote` | sim |
| `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` | envio e conexão do WhatsApp (inbox, ações rápidas e lote) | sim, para WhatsApp |
| `RESEND_API_KEY`, `RESEND_REMETENTE` | e-mail de convite, de redefinição de senha e campanhas (sem a chave o convite é criado e a tela mostra o link para copiar; o remetente padrão é `no-reply@medguia.cloud`) | recomendada |
| `RESEND_WEBHOOK_SECRET` | aceitar os eventos de entrega, abertura e clique das campanhas | sim, para campanhas |
| `GOOGLE_*`, `SUPABASE_*`, `SUPABASE_LP_*` | ETL e espelho do Sheets durante a migração dos dados | só enquanto houver ETL |

Nunca escreva valores neste repositório.

## 5. Agendadores (cron da VPS)

Duas rotas internas, protegidas por `Authorization: Bearer <CRON_SEGREDO>`, sem sessão. Elas
são chamadas por um agendador externo (crontab da VPS ou equivalente) **de dentro da rede
do Docker** ou pelo proxy:

```cron
# virada de dia da cadência: uma vez por dia (fuso de São Paulo; antes do primeiro turno)
5 0 * * *  curl -fsS -X POST -H "Authorization: Bearer $CRON_SEGREDO" http://scrumboard-medguia:3000/api/cron/cadencia

# WhatsApp em lote: A CADA MINUTO. Cada chamada trabalha até ~55 s, mandando uma mensagem
# por vez com 15 a 45 s entre elas. Sem este agendador os lotes ficam parados na fila.
* * * * *  curl -fsS -m 65 -X POST -H "Authorization: Bearer $CRON_SEGREDO" http://scrumboard-medguia:3000/api/cron/whatsapp-lote
```

- A cadência registra cada execução em `cron_execucoes` (job `cadencia-virada-dia`); o lote,
  em `cron_execucoes` com o job `whatsapp-lote`. Use essa tabela para saber se rodou.
- Chamadas sobrepostas do lote são seguras (um envio nunca é pego duas vezes e o intervalo
  vale por `proximo_envio_em`).
- Conferir o horário da virada de dia com a operação antes de fixar.

## 6. Webhooks de entrada

- **Evolution → CRM:** `POST /api/whatsapp/webhook`. Configurado pela própria tela
  `/whatsapp/configuracao` (a URL é montada a partir de `NEXT_PUBLIC_APP_URL`).
- **Resend → CRM:** `POST /api/webhooks/resend`, assinado com `RESEND_WEBHOOK_SECRET`.

## 7. Dados e configuração inicial

1. **Dados:** migração (ETL) dos leads e do histórico conforme `fase3-etl*` e
   `fase3-ingestao-continua`. Pendências conhecidas: o RLS da LP (Q-033, fora do CRM), o
   espelho do Sheets e a subida do worker.
2. **Pessoas:** criar o primeiro super admin direto no banco (`usuarios.is_super_admin`) e,
   pela tela `/admin/empresas`, cada empresa com o **master convidado**. Preencher
   razão social, CNPJ, plano e **assentos** (vazio = sem limite).
3. **Por empresa:** a instância do WhatsApp em `/whatsapp/configuracao` e a conexão por
   QR Code em `/whatsapp/conexao`; as **metas** em `/configuracoes/metas`; o
   **investimento em mídia** do mês em `/configuracoes/investimento`; os **templates**
   de WhatsApp em `/whatsapp/templates` (só os aprovados valem em lote).
4. **Consentimento:** nenhum lead migrado tem consentimento de WhatsApp. O lote só
   alcança quem foi marcado como "autoriza receber WhatsApp" no card.

## 8. Conferência depois do deploy

- [ ] `GET /api/health` responde e o container novo está de pé; o legado foi parado.
- [ ] Login com o super admin e com um master; **empresa inativa bloqueia o login** (exceto super admin).
- [ ] Menu de cada papel: o atendente **não** vê Administração, Análises nem "Envio em Lote".
- [ ] Funil e lista carregam com os leads migrados; mover um card e arquivar com motivo funcionam.
- [ ] Um card de teste: registrar consentimento, "Ligar Agora" abre o discador, "Promover a Lead" a partir de um número avulso.
- [ ] Agenda: agendar e cancelar uma reunião (o card volta para "Qualificado p/ reunião").
- [ ] WhatsApp: mensagem de entrada aparece na inbox; envio avulso sai pela instância da empresa.
- [ ] Lote de teste com 1 lead consentido (seu próprio número): aparece em `/whatsapp/lote`, a mensagem chega com o intervalo certo e o lote conclui; `cron_execucoes` mostra `whatsapp-lote` com `sucesso`.
- [ ] Campanha pequena de e-mail: eventos do Resend atualizam os contadores.
- [ ] `cron_execucoes` mostra a virada de dia da cadência no dia seguinte.
- [ ] Backup noturno rodando (`infra/backup/crontab`) e um restore ensaiado conforme `restore-backup-crm.md`.

## 9. Plano de volta

- O banco do CRM é **separado** (`crm_prod`): o legado continua com o Supabase, intacto.
  Voltar é parar o container novo e subir de novo a imagem legada com o mesmo nome.
- As migrations só acrescentam; voltar o app não exige desfazer nada no banco.
- Mensagens de WhatsApp já enviadas por lote não se desfazem; **cancele o lote em andamento**
  em `/whatsapp/lote` (ou pare o agendador do lote) antes de voltar.
- Registre aqui o que deu errado e o horário.

## 10. Pendências fora deste cutover

- **Integração com o Meta Ads** para o investimento em mídia: versão 2 (hoje o cadastro é manual).
- **Q-055:** o motor externo de e-mail consegue pausar um disparo e aceitar variáveis de texto? Em aberto.
- **Meta de receita** (Novo MRR): Q-061, depende do período do relatório.
- Limite e intervalo do lote são valores do sistema (50 leads, 15 a 45 s); configurar por empresa é evolução.
- Reenviar os que falharam num lote, agendar lote e mais de um lote por vez: fora do escopo atual.

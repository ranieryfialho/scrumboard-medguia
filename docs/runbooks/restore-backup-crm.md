# Runbook: Restore do backup do CRM

> Feature: `fase0-fundacao-ci-staging` · Critério de aceite: AC-012
> Script: [`infra/backup/restore-crm.sh`](../../infra/backup/restore-crm.sh)

## Quando usar

- **Ensaio periódico** (recomendado): provar, de tempos em tempos, que o
  backup diário (`infra/backup/backup-crm.sh`, AC-010) é de fato restaurável
  — não só que o arquivo existe no remote.
- **Incidente real**: `pg-master` perdeu dados/disco corrompeu e é preciso
  recuperar `crm_prod` a partir do último dump bom.

Em ambos os casos, o restore roda **sempre contra `crm_staging`** primeiro.
Nunca aponte o script direto para `crm_prod` — o script recusa essa
combinação (`PG_TARGET_DATABASE=crm_prod` falha imediatamente).

## Pré-requisitos

- Acesso SSH à VPS onde roda o container `pg-master`.
- `docker` disponível no host que executa o script (o restore roda `docker
  exec`/`docker cp` contra o container do Postgres — não precisa de `psql`
  nem de driver de banco no host).
- Um dump gerado pelo `backup-crm.sh` (arquivo `crm_prod_<timestamp>.dump`)
  e, se disponível, o checksum correspondente (`<mesmo nome>.sha256`) —
  ambos ficam no remote do `rclone` (`gdrive:backups/crm`, ver AC-010).

## Procedimento

### 1. Baixar o dump do remote

```bash
rclone copy "gdrive:backups/crm/crm_prod_2026-09-23_030000.dump" .
rclone copy "gdrive:backups/crm/crm_prod_2026-09-23_030000.dump.sha256" .
```

### 2. Rodar o restore contra staging

```bash
cd /root/scrumboard-medguia
set -a && . ./.env && set +a   # POSTGRES_ADMIN_USER, PG_CONTAINER etc.
./infra/backup/restore-crm.sh crm_prod_2026-09-23_030000.dump
```

O script, nessa ordem:

1. Confere o checksum do dump contra o `.sha256` baixado junto (recusa
   seguir se não bater — dump corrompido).
2. Valida a estrutura do dump com `pg_restore --list` (recusa seguir se o
   arquivo não for um dump `pg_restore` válido).
3. Copia o dump para dentro do container `pg-master` (`docker cp`).
4. Restaura em `crm_staging` com `pg_restore --clean --if-exists
   --no-owner` — objetos existentes em `crm_staging` são substituídos pelo
   conteúdo do dump (idempotente: pode rodar de novo sem acumular lixo).
5. Consulta `crm_staging` depois do restore (`information_schema.tables`) e
   imprime quantas tabelas foram restauradas, provando que o banco ficou
   **consultável**, não só que o comando terminou sem erro.

Saída esperada:

```
[restore-crm] verificando checksum sha256 do dump...
crm_prod_2026-09-23_030000.dump: OK
[restore-crm] validando a estrutura do dump (pg_restore --list)...
[restore-crm] copiando o dump para dentro do container pg-master...
[restore-crm] restaurando em crm_staging (--clean --if-exists --no-owner)...
[restore-crm] verificando que crm_staging ficou íntegro e consultável...
[restore-crm] restore concluído: crm_staging consultável, N tabela(s) em public
```

### 3. Conferir os dados manualmente (opcional, recomendado no primeiro ensaio)

```bash
docker exec -it pg-master psql -U admin -d crm_staging -c '\dt'
docker exec -it pg-master psql -U admin -d crm_staging -c 'SELECT count(*) FROM <tabela-conhecida>;'
```

Compare com o que se espera do momento em que o dump foi tirado.

## Variáveis de ambiente do script

| Variável | Default | Descrição |
|---|---|---|
| `PG_CONTAINER` | `pg-master` | Container do Postgres onde o restore roda. |
| `PG_TARGET_DATABASE` | `crm_staging` | Database de destino. O script recusa `crm_prod`. |
| `POSTGRES_ADMIN_USER` | `admin` | Usuário usado para `pg_restore`/`psql` dentro do container. |

## Recuperação de um incidente real em produção (fora do ensaio de rotina)

O restore ensaiado por este runbook prova que o backup funciona, mas a
restauração de `crm_prod` num incidente real é uma decisão operacional
deliberada, não automatizada por este script (evita apagar produção sem
segunda confirmação). Nesse cenário:

1. Rode este mesmo procedimento contra `crm_staging` primeiro, para
   confirmar que o dump escolhido está íntegro.
2. Só então, manualmente e com o serviço `crm-app` de produção parado,
   restaure em `crm_prod` repetindo os passos do script com
   `PG_TARGET_DATABASE=crm_prod` feito à mão (o guard de "nunca aponte para
   crm_prod" existe para o uso rotineiro do script, não para bloquear um
   incidente real onde essa é exatamente a intenção).

## Relacionado

- `infra/backup/backup-crm.sh` — gera o dump que este runbook restaura
  (AC-010).
- `/api/health` (T-009, ainda não implementado nesta feature) — reporta a
  idade do último backup bem-sucedido, para saber se há um dump recente
  para ensaiar.

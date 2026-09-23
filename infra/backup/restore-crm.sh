#!/usr/bin/env bash
# Restore ensaiado de um dump gerado por infra/backup/backup-crm.sh, contra
# o database de staging (AC-012). Ver spec fase0-fundacao-ci-staging e
# docs/runbooks/restore-backup-crm.md para o procedimento completo.
#
# Uso:
#   ./restore-crm.sh <caminho-do-dump>
#
# O dump é o arquivo .dump (pg_dump --format=custom) baixado do remote do
# rclone. Se existir um arquivo "<dump>.sha256" ao lado (o checksum gravado
# pelo backup-crm.sh), o restore recusa seguir se o conteúdo não bater —
# prova que o backup é restaurável de fato, não só "existe o arquivo".
#
# Variáveis de ambiente (com default de produção entre parênteses):
#   PG_CONTAINER          nome do container do Postgres (pg-master)
#   PG_TARGET_DATABASE    database onde o dump é restaurado (crm_staging) —
#                         nunca aponte para crm_prod aqui
#   POSTGRES_ADMIN_USER   usuário usado para o pg_restore dentro do container
set -uo pipefail

# Evita que o Git Bash/MSYS (Windows) reescreva caminhos estilo Unix
# (ex.: /tmp/...) passados como argumento ao docker.exe como se fossem
# caminhos do host — sem isso, o pg_restore dentro do container recebe um
# caminho Windows que não existe lá dentro. Inofensivo em Linux/macOS.
export MSYS_NO_PATHCONV=1

PG_CONTAINER="${PG_CONTAINER:-pg-master}"
PG_TARGET_DATABASE="${PG_TARGET_DATABASE:-crm_staging}"
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-admin}"

DUMP_FILE="${1:-}"
CHECKSUM_FILE="${DUMP_FILE}.sha256"
REMOTE_DUMP_PATH="/tmp/restore-crm-$$.dump"

fail() {
  local motivo="$1"
  echo "[restore-crm] FALHA: ${motivo}" >&2
  exit 1
}

[[ -n "$DUMP_FILE" ]] || fail "uso: ./restore-crm.sh <caminho-do-dump>"
[[ -s "$DUMP_FILE" ]] || fail "o dump '${DUMP_FILE}' não existe ou está vazio"

if [[ "$PG_TARGET_DATABASE" == "crm_prod" ]]; then
  fail "restore nunca pode apontar para crm_prod — use crm_staging"
fi

if [[ -f "$CHECKSUM_FILE" ]]; then
  echo "[restore-crm] verificando checksum sha256 do dump..."
  (cd "$(dirname "$DUMP_FILE")" && sha256sum -c "$(basename "$CHECKSUM_FILE")") \
    || fail "checksum de '${DUMP_FILE}' não confere com '${CHECKSUM_FILE}' — dump corrompido"
else
  echo "[restore-crm] aviso: nenhum arquivo de checksum '${CHECKSUM_FILE}' encontrado, seguindo sem verificar" >&2
fi

echo "[restore-crm] validando a estrutura do dump (pg_restore --list)..."
docker exec -i "$PG_CONTAINER" pg_restore --list < "$DUMP_FILE" > /dev/null \
  || fail "o dump '${DUMP_FILE}' está corrompido ou num formato inválido (pg_restore --list falhou)"

echo "[restore-crm] copiando o dump para dentro do container ${PG_CONTAINER}..."
docker cp "$DUMP_FILE" "${PG_CONTAINER}:${REMOTE_DUMP_PATH}" \
  || fail "não foi possível copiar '${DUMP_FILE}' para o container ${PG_CONTAINER}"

cleanup() {
  docker exec "$PG_CONTAINER" rm -f "$REMOTE_DUMP_PATH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[restore-crm] restaurando em ${PG_TARGET_DATABASE} (--clean --if-exists --no-owner)..."
docker exec "$PG_CONTAINER" \
  pg_restore --clean --if-exists --no-owner --exit-on-error \
  -U "$POSTGRES_ADMIN_USER" -d "$PG_TARGET_DATABASE" "$REMOTE_DUMP_PATH" \
  || fail "pg_restore em ${PG_TARGET_DATABASE} (container ${PG_CONTAINER}) retornou erro"

echo "[restore-crm] verificando que ${PG_TARGET_DATABASE} ficou íntegro e consultável..."
RESTORED_TABLES="$(docker exec "$PG_CONTAINER" \
  psql -U "$POSTGRES_ADMIN_USER" -d "$PG_TARGET_DATABASE" -v ON_ERROR_STOP=1 -t -A \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" \
  || fail "não foi possível consultar ${PG_TARGET_DATABASE} depois do restore — banco não ficou consultável"

echo "[restore-crm] restore concluído: ${PG_TARGET_DATABASE} consultável, ${RESTORED_TABLES} tabela(s) em public"

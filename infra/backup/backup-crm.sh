#!/usr/bin/env bash
# Backup diário do database crm_prod: pg_dump + checksum + envio para fora
# da VPS via rclone (AC-010), com alerta via Evolution API se o job falhar
# (AC-011). Ver RFC-001 §8 (Opção B2, item 6) e spec fase0-fundacao-ci-staging
# — modelado no script que já roda na VPS para o outro projeto
# (/root/backups/supabase/backup-supabase.sh).
#
# Variáveis de ambiente (com default de produção entre parênteses):
#   PG_CONTAINER          nome do container do Postgres (pg-master)
#   PG_DATABASE           database a fazer dump (crm_prod)
#   POSTGRES_ADMIN_USER   usuário usado para o pg_dump dentro do container
#   BACKUP_DIR            diretório local de staging do dump
#                         (/root/backups/crm)
#   RCLONE_REMOTE         destino do rclone, pasta própria do CRM
#                         (gdrive:backups/crm)
#   EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE,
#   ALERT_WHATSAPP_NUMBER credenciais/destino do alerta (mesmo padrão do
#                         script existente) — sem elas, o alerta é pulado
#                         com aviso em stderr (nunca derruba o script).
set -uo pipefail

PG_CONTAINER="${PG_CONTAINER:-pg-master}"
PG_DATABASE="${PG_DATABASE:-crm_prod}"
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-admin}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/crm}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive:backups/crm}"

EVOLUTION_API_URL="${EVOLUTION_API_URL:-}"
EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-}"
EVOLUTION_INSTANCE="${EVOLUTION_INSTANCE:-}"
ALERT_WHATSAPP_NUMBER="${ALERT_WHATSAPP_NUMBER:-}"

STAMP="$(date -u +%Y-%m-%d_%H%M%S)"
DUMP_FILE="crm_prod_${STAMP}.dump"
CHECKSUM_FILE="${DUMP_FILE}.sha256"
LAST_SUCCESS_FILE="${BACKUP_DIR}/.last-success"

# Envia o alerta no mesmo padrão do script existente na VPS: POST em
# /message/sendText/{instance} da Evolution API. Sem credenciais
# configuradas, apenas avisa em stderr — nunca derruba o job por isso.
send_alert() {
  local mensagem="$1"
  if [[ -z "$EVOLUTION_API_URL" || -z "$EVOLUTION_API_KEY" || -z "$EVOLUTION_INSTANCE" || -z "$ALERT_WHATSAPP_NUMBER" ]]; then
    echo "[backup-crm] alerta não enviado: credenciais da Evolution API ausentes" >&2
    return 0
  fi
  curl -sS -X POST \
    "${EVOLUTION_API_URL%/}/message/sendText/${EVOLUTION_INSTANCE}" \
    -H "Content-Type: application/json" \
    -H "apikey: ${EVOLUTION_API_KEY}" \
    -d "$(printf '{"number":"%s","text":"%s"}' "$ALERT_WHATSAPP_NUMBER" "$mensagem")" \
    >/dev/null 2>&1 || echo "[backup-crm] falha ao chamar a Evolution API para alertar" >&2
}

fail() {
  local motivo="$1"
  echo "[backup-crm] FALHA: ${motivo}" >&2
  send_alert "🔴 Backup do CRM (${PG_DATABASE}) falhou: ${motivo}"
  exit 1
}

mkdir -p "$BACKUP_DIR" || fail "não foi possível criar o diretório de staging ${BACKUP_DIR}"
cd "$BACKUP_DIR" || fail "não foi possível acessar o diretório de staging ${BACKUP_DIR}"

docker exec "$PG_CONTAINER" \
  pg_dump --format=custom --no-owner -U "$POSTGRES_ADMIN_USER" "$PG_DATABASE" \
  > "$DUMP_FILE" || fail "pg_dump de ${PG_DATABASE} (container ${PG_CONTAINER}) retornou erro"

[[ -s "$DUMP_FILE" ]] || fail "o dump gerado está vazio"

sha256sum "$DUMP_FILE" > "$CHECKSUM_FILE" || fail "falha ao gerar o checksum sha256 do dump"

rclone copy "$DUMP_FILE" "${RCLONE_REMOTE}/" || fail "rclone copy do dump para ${RCLONE_REMOTE} falhou"
rclone copy "$CHECKSUM_FILE" "${RCLONE_REMOTE}/" || fail "rclone copy do checksum para ${RCLONE_REMOTE} falhou"

date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_SUCCESS_FILE"

echo "[backup-crm] backup concluído: ${DUMP_FILE}"

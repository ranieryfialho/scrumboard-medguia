#!/usr/bin/env bash
# Deploy do CRM na VPS (roda LÁ, chamado pelo workflow .github/workflows/deploy-crm.yml por SSH).
# Uso: deploy.sh <staging|prod> <sha-completo-do-commit>
#
# O que faz, em ordem (qualquer falha ANTES da troca da imagem aborta sem tocar no que está no ar):
#   1. baixa a imagem nova (pull);  2. backup do banco (pg_dump -Fc);  3. aplica as migrations pendentes como crm_migrator;
#   4. troca a imagem (up -d, SEM --remove-orphans);  5. teste de saúde; se falhar, volta para a imagem anterior.
# Migrations só acrescentam (ver docs/runbooks/cutover-crm.md): voltar a imagem não exige desfazer o banco.
set -euo pipefail

AMBIENTE="${1:?uso: $0 <staging|prod> <sha>}"
SHA="${2:?uso: $0 <staging|prod> <sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA inválido (precisa ter os 40 caracteres): $SHA"; exit 1; }

REPO=/root/crm-staging   # clone do repositório (as migrations vêm daqui, direto do commit, sem mexer na árvore de trabalho)
case "$AMBIENTE" in
  staging) DIR=/root/crm-staging; COMPOSE=docker-compose.staging.yml; ENVF=.env.staging; BANCO=crm_staging; APP=crm-app-staging ;;
  prod)    DIR=/root/crm-prod;    COMPOSE=docker-compose.prod.yml;    ENVF=.env.prod;    BANCO=crm_prod;    APP=crm-app-prod ;;
  *) echo "ambiente desconhecido: $AMBIENTE"; exit 1 ;;
esac

log() { printf '%s [%s] %s\n' "$(date +%H:%M:%S)" "$AMBIENTE" "$*"; }
psql_mig() { docker exec -i pg-master psql -U crm_migrator -d "$BANCO" -v ON_ERROR_STOP=1 -q "$@"; }
# O IMAGE_TAG vai sempre inline: vence o .env e não depende de nada exportado em shell antigo.
compose() { (cd "$DIR" && IMAGE_TAG="$1" docker compose -f "$COMPOSE" --env-file "$ENVF" "${@:2}"); }

# --- 0. o commit existe no clone? (o staging também atualiza o compose do repositório)
git -C "$REPO" fetch -q origin
git -C "$REPO" cat-file -e "${SHA}^{commit}" || { log "commit $SHA não encontrado no clone"; exit 1; }
[ "$AMBIENTE" = staging ] && git -C "$REPO" pull -q --ff-only || true

ANTERIOR=$(docker inspect "$APP" --format '{{.Config.Image}}' 2>/dev/null | sed 's/.*://' || true)
[[ "$ANTERIOR" =~ ^[0-9a-f]{40}$ ]] || { log "não consegui ler a imagem atual de $APP (veio: '$ANTERIOR'); abortando"; exit 1; }
log "atual: ${ANTERIOR:0:9}  →  novo: ${SHA:0:9}"
if [ "$ANTERIOR" = "$SHA" ]; then log "já está nessa versão; só conferindo a saúde"; fi

# --- 1. imagem nova (se não existir no GHCR, para aqui, sem ter mexido em nada)
compose "$SHA" pull

# --- 2. backup
mkdir -p /root/backups
ARQ="/root/backups/${BANCO}-pre-deploy_$(date +%Y%m%d_%H%M%S)_${SHA:0:9}.dump"
docker exec pg-master pg_dump -U admin -Fc "$BANCO" > "$ARQ"
[ -s "$ARQ" ] || { log "backup vazio; abortando"; rm -f "$ARQ"; exit 1; }
log "backup: $ARQ ($(du -h "$ARQ" | cut -f1))"
find /root/backups -name "${BANCO}-pre-deploy_*.dump" -mtime +14 -delete

# --- 3. migrations pendentes. Não há tabela de controle do Drizzle (as migrations são escritas à mão): usamos `migracoes_aplicadas`.
if [ "$(psql_mig -tA -c "select to_regclass('public.migracoes_aplicadas') is not null")" != "t" ]; then
  log "primeira execução: registrando como já aplicadas as migrations da versão atual (${ANTERIOR:0:9})"
  psql_mig -c "create table public.migracoes_aplicadas (arquivo text primary key, aplicada_em timestamptz not null default now())"
  git -C "$REPO" ls-tree --name-only "$ANTERIOR" drizzle/ | grep -E '^drizzle/[0-9]+.*\.sql$' | sed 's#drizzle/##' \
    | while read -r f; do psql_mig -c "insert into public.migracoes_aplicadas (arquivo) values ('$f') on conflict do nothing"; done
fi
PENDENTES=$(git -C "$REPO" ls-tree --name-only "$SHA" drizzle/ | grep -E '^drizzle/[0-9]+.*\.sql$' | sed 's#drizzle/##' | sort | while read -r f; do
  [ "$(psql_mig -tA -c "select 1 from public.migracoes_aplicadas where arquivo = '$f'")" = "1" ] || echo "$f"
done)
if [ -z "$PENDENTES" ]; then log "migrations: nenhuma pendente"; else
  for f in $PENDENTES; do
    log "aplicando $f"
    git -C "$REPO" show "$SHA:drizzle/$f" | psql_mig || { log "FALHOU em $f: a imagem NÃO foi trocada; o backup está em $ARQ"; exit 1; }
    psql_mig -c "insert into public.migracoes_aplicadas (arquivo) values ('$f')"
  done
fi

# --- 4. troca da imagem (nunca --remove-orphans)
compose "$SHA" up -d
if [ "$AMBIENTE" = prod ] && grep -q '^IMAGE_TAG=' "$DIR/$ENVF"; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$SHA/" "$DIR/$ENVF"; fi

# --- 5. saúde: a tela de login (pública) responde 200 de dentro do container
saudavel() {
  docker exec "$APP" node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" 2>/dev/null
}
for i in $(seq 1 24); do
  if saudavel; then log "saudável (tentativa $i)"; docker ps --format '  {{.Names}}  {{.Image}}' | grep -E "crm-.*-${AMBIENTE}" || true; log "OK"; exit 0; fi
  sleep 5
done

log "NÃO FICOU SAUDÁVEL em 2 minutos; voltando para ${ANTERIOR:0:9}"
compose "$ANTERIOR" up -d
if [ "$AMBIENTE" = prod ] && grep -q '^IMAGE_TAG=' "$DIR/$ENVF"; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$ANTERIOR/" "$DIR/$ENVF"; fi
exit 1

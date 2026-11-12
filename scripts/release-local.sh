#!/usr/bin/env bash
# Plano B do Release + Deploy para quando os minutos do GitHub Actions acabam. Faz, no seu notebook, o que
# .github/workflows/release.yml e deploy-crm.yml fazem:
#   1. constrói as duas imagens (site e worker) de um commit da main, com a tag = SHA completo do commit;
#   2. publica as duas no GHCR (ghcr.io/<dono>/scrumboard-medguia e scrumboard-medguia-worker);
#   3. faz o deploy por SSH (deploy/deploy.sh: backup do banco, migrations, troca da imagem, teste de saúde e rollback).
# As imagens são construídas a partir do commit (git archive), nunca da sua pasta de trabalho: alterações locais não entram.
#
# Uso:    scripts/release-local.sh [staging|prod] [SHA] [--simular] [--sem-deploy]
#   staging|prod  onde implantar (padrão: staging). A produção pede para digitar PRODUCAO, e o deploy.sh só aceita nela uma versão
#                 que já esteja rodando no staging.
#   SHA           commit completo (40 caracteres) que esteja na main (padrão: o último da origin/main)
#   --simular     só confere e mostra o que faria; não constrói, não publica e não conecta na VPS
#   --sem-deploy  constrói e publica as imagens, mas não faz o deploy
#   --pular-build não constrói nem publica: usa as imagens desse commit que já estão no GHCR (para repetir só o deploy)
#
# Antes da primeira vez:  gh auth refresh -h github.com -s write:packages
# Variáveis:  VPS_HOST (obrigatória no deploy)  VPS_USER (padrão: root)  SSH_OPCOES (opcional, ex.: "-i ~/.ssh/minha_chave -p 2222")
# O SSH pede a senha se a VPS usar senha (uma vez só: a conexão é reaproveitada pelos dois comandos).
# Valores de build (NEXT_PUBLIC_*, EVOLUTION_*): lidos do .env.local. Eles ficam GRAVADOS na imagem e a mesma imagem vale para staging
# e produção; por isso o script mostra os não secretos e pede confirmação antes de construir.
set -euo pipefail

AMBIENTE=staging
SHA=""
SIMULAR=0
SEM_DEPLOY=0
PULAR_BUILD=0
for argumento in "$@"; do
  case "$argumento" in
    staging|prod) AMBIENTE="$argumento" ;;
    --simular) SIMULAR=1 ;;
    --sem-deploy) SEM_DEPLOY=1 ;;
    --pular-build) PULAR_BUILD=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) if [[ "$argumento" =~ ^[0-9a-f]{40}$ ]]; then SHA="$argumento"; else echo "Argumento desconhecido: $argumento (use --help)"; exit 1; fi ;;
  esac
done

executar() { if [ "$SIMULAR" = 1 ]; then echo "   [simulação] $*"; else "$@"; fi; }
passo() { echo; echo "==> $*"; }

cd "$(git rev-parse --show-toplevel)"

passo "1/5 Conferindo o commit"
git fetch origin main -q
[ -n "$SHA" ] || SHA="$(git rev-parse origin/main)"
git merge-base --is-ancestor "$SHA" origin/main || { echo "O commit $SHA não está na origin/main: o deploy só aceita commits da main."; exit 1; }
echo "   commit: $SHA ($(git log -1 --format=%s "$SHA"))"
echo "   ambiente: $AMBIENTE"

passo "2/5 Conferindo as ferramentas e o acesso ao GHCR"
command -v docker >/dev/null || { echo "docker não encontrado."; exit 1; }
command -v gh >/dev/null || { echo "gh não encontrado."; exit 1; }
DONO="$(gh repo view --json owner --jq .owner.login)"
if ! gh auth status 2>&1 | grep -q 'write:packages'; then
  echo "O token do gh não tem a permissão write:packages. Rode uma vez:  gh auth refresh -h github.com -s write:packages"
  [ "$SIMULAR" = 1 ] || exit 1
  echo "   [simulação] seguiria mesmo assim"
fi
IMAGEM_SITE="ghcr.io/$DONO/scrumboard-medguia:$SHA"
IMAGEM_WORKER="ghcr.io/$DONO/scrumboard-medguia-worker:$SHA"
echo "   $IMAGEM_SITE"
echo "   $IMAGEM_WORKER"

passo "3/5 Valores de build (do .env.local)"
[ -f .env.local ] || { echo ".env.local não encontrado."; exit 1; }
valor() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
for variavel in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_APP_URL EVOLUTION_API_URL EVOLUTION_API_KEY; do
  v="$(valor "$variavel")"
  [ -n "$v" ] || { echo "$variavel está vazio ou ausente no .env.local."; exit 1; }
  export "$variavel=$v"
done
servidor() { echo "$1" | sed -E 's#^(https?://)([^/]+).*#\2#'; }
echo "   NEXT_PUBLIC_APP_URL        = $NEXT_PUBLIC_APP_URL"
echo "   NEXT_PUBLIC_SUPABASE_URL   = https://$(servidor "$NEXT_PUBLIC_SUPABASE_URL")"
echo "   EVOLUTION_API_URL          = https://$(servidor "$EVOLUTION_API_URL")"
echo "   (as chaves não são mostradas; elas ficam gravadas na imagem, como no Release do GitHub)"
if [ "$SIMULAR" = 0 ]; then
  read -r -p "   Estes são os valores usados nos secrets do GitHub para o CRM no ar? [s/N] " resposta
  [[ "$resposta" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 1; }
fi

passo "4/5 Construindo e publicando as imagens (a primeira vez demora; as camadas ficam em cache)"
if [ "$PULAR_BUILD" = 1 ]; then
  echo "   --pular-build: usando as imagens que já estão no GHCR."
elif true; then
if [ "$SIMULAR" = 0 ]; then gh auth token | docker login ghcr.io -u "$DONO" --password-stdin; else echo "   [simulação] docker login ghcr.io"; fi
ARGS_DE_BUILD=(--build-arg NEXT_PUBLIC_SUPABASE_URL --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY --build-arg NEXT_PUBLIC_APP_URL --build-arg EVOLUTION_API_URL --build-arg EVOLUTION_API_KEY)
if [ "$SIMULAR" = 0 ]; then
  git archive "$SHA" | docker build "${ARGS_DE_BUILD[@]}" -t "$IMAGEM_SITE" -
  git archive "$SHA" | docker build --target worker -t "$IMAGEM_WORKER" -
  docker push "$IMAGEM_SITE"
  docker push "$IMAGEM_WORKER"
else
  echo "   [simulação] git archive $SHA | docker build (site)  -> $IMAGEM_SITE"
  echo "   [simulação] git archive $SHA | docker build --target worker -> $IMAGEM_WORKER"
  echo "   [simulação] docker push (as duas)"
fi
fi

if [ "$SEM_DEPLOY" = 1 ]; then echo; echo "Imagens publicadas. (--sem-deploy: o deploy não foi feito)"; exit 0; fi

passo "5/5 Deploy no $AMBIENTE"
[ -n "${VPS_HOST:-}" ] || { echo "Defina VPS_HOST (o endereço que você usa no ssh da VPS). Ex.: VPS_HOST=... scripts/release-local.sh $AMBIENTE"; [ "$SIMULAR" = 1 ] && echo "   [simulação] seguiria mesmo assim" || exit 1; }
VPS_USER="${VPS_USER:-root}"
if [ "$AMBIENTE" = prod ] && [ "$SIMULAR" = 0 ]; then
  read -r -p "   PRODUÇÃO. Digite PRODUCAO para continuar: " resposta
  [ "$resposta" = PRODUCAO ] || { echo "Cancelado."; exit 1; }
fi
if [ "$SIMULAR" = 1 ]; then
  echo "   [simulação] git show $SHA:deploy/deploy.sh | ssh $VPS_USER@${VPS_HOST:-<VPS_HOST>} 'cat > /tmp/deploy-crm.sh'"
  echo "   [simulação] ssh $VPS_USER@${VPS_HOST:-<VPS_HOST>} \"bash /tmp/deploy-crm.sh '$AMBIENTE' '$SHA' 'false'\""
  echo; echo "Simulação concluída: nada foi construído, publicado nem implantado."
  exit 0
fi
# Sem BatchMode: se a VPS usa senha, o ssh pergunta. ControlMaster reaproveita a conexão, então a senha é pedida uma vez só.
CONEXAO="$(mktemp -u /tmp/release-local-ssh.XXXXXX)"
# shellcheck disable=SC2206
SSH=(ssh -o ControlMaster=auto -o "ControlPath=$CONEXAO" -o ControlPersist=120 -o ServerAliveInterval=30 ${SSH_OPCOES:-} "$VPS_USER@$VPS_HOST")
trap '"${SSH[@]}" -O exit >/dev/null 2>&1 || true' EXIT
# O script vai para a VPS e roda como ARQUIVO (como no workflow): se fosse lido pelo stdin do bash, um comando que lê o stdin
# (docker exec -i, por exemplo) engoliria o resto e o deploy terminaria "com sucesso" pela metade.
git show "$SHA:deploy/deploy.sh" | "${SSH[@]}" "cat > /tmp/deploy-crm.sh && chmod 700 /tmp/deploy-crm.sh"
SAIDA="$(mktemp)"
# A saída completa vai para $SAIDA; na tela ficam de fora as linhas de progresso do download das camadas.
"${SSH[@]}" "bash /tmp/deploy-crm.sh '$AMBIENTE' '$SHA' 'false' < /dev/null" 2>&1 | tee "$SAIDA" | grep -vE '^ [0-9a-f]{12} (Extracting|Downloading|Pulling fs layer|Waiting|Verifying Checksum|Download complete|Pull complete|Already exists)'
grep -q 'DEPLOY_CONCLUIDO' "$SAIDA" || { echo "O deploy não chegou ao fim (sem DEPLOY_CONCLUIDO)."; exit 1; }
echo; echo "Pronto: $SHA no $AMBIENTE."

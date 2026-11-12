# Release e deploy manual (quando o GitHub Actions não roda)

Use quando os **minutos do GitHub Actions acabam** (repositório privado: franquia mensal de ~2.000 min; sem minutos os jobs nem iniciam, com a
mensagem "recent account payments have failed or your spending limit needs to be increased") ou quando o Actions estiver fora do ar. Sem Actions
não há Release (imagem) nem Deploy do CRM; este roteiro faz os dois no notebook, com o mesmo `deploy/deploy.sh` do fluxo normal
(ver [deploy-automatico.md](deploy-automatico.md)): backup do banco, migrations, teste de saúde e rollback automático.

## Antes da primeira vez
- Docker e `gh` instalados; `gh auth refresh -h github.com -s write:packages` (uma vez, abre o navegador).
- Acesso SSH à VPS (login por senha ou chave). Exporte `VPS_HOST` (e `VPS_USER`, se não for `root`; `SSH_OPCOES` para chave/porta).
- `.env.local` com os valores de build (veja abaixo).

## Passo a passo
1. **Merge na `main`** do que vai subir. Com o `gates` sem poder rodar, o merge só passa pela exceção de administrador na regra `main-protection`
   (Settings → Rules → Bypass list → Repository admin, "For pull requests only"). **Remova a exceção quando os minutos voltarem.**
2. **Staging:** `git fetch origin && VPS_HOST=<vps> scripts/release-local.sh staging`. Constrói as duas imagens (site e worker) do último commit da
   `main`, publica no GHCR (tag = SHA) e implanta. Para ensaiar sem fazer nada: acrescente `--simular`.
3. **Confira o staging** no navegador.
4. **Produção** com **as mesmas imagens** testadas: `VPS_HOST=<vps> scripts/release-local.sh prod <SHA completo> --pular-build`. Pede para digitar
   `PRODUCAO`; o `deploy.sh` recusa o que não estiver rodando no staging (`ignorar_staging` não existe aqui: rollback é feito pelo workflow ou à mão).
5. Confirme `DEPLOY_CONCLUIDO` no fim da saída e abra a tela de login do ambiente.

Opções: `--sem-deploy` (só publica as imagens) e `--pular-build` (só repete o deploy com imagens já publicadas).

## Valores de build
Só os três `NEXT_PUBLIC_*` ficam **gravados dentro da imagem** (e a mesma imagem vale para staging e produção): `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `EVOLUTION_API_URL/KEY` não ficam na imagem: vêm do `.env.staging`/`.env.prod` da VPS.
Em 12/11/2026 os valores do `.env.local` foram comparados (por hash) com a imagem construída pelo GitHub e eram idênticos. O script mostra a URL do
app e pede confirmação antes de construir. Se os secrets do GitHub mudarem, atualize o `.env.local` (ou confira a imagem no ar antes).

## Cuidados
- A imagem é construída do commit (`git archive`), nunca da pasta de trabalho: alterações locais não entram.
- A construção completa leva ~3 a 4 minutos; com as camadas em cache, segundos.
- O staging também atualiza o compose do repositório na VPS (`git pull` do `deploy.sh`): mudanças em `docker-compose.staging.yml` valem no deploy seguinte.
- Segredos de execução (`.env.staging`/`.env.prod`) ficam só na VPS; nunca os cole em chat nem os commite.

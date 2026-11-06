# Deploy automático do CRM

Fluxo: merge na `main` → CI → Release (publica a imagem) → **Deploy do CRM**: staging sozinho; produção depois do clique de aprovação.

- Workflow: `.github/workflows/deploy-crm.yml`; script que roda na VPS: `deploy/deploy.sh <staging|prod> <sha>`.
- O script faz: pull da imagem → `pg_dump` (`/root/backups/<banco>-pre-deploy_*.dump`, 14 dias) → migrations pendentes como `crm_migrator`
  (controle na tabela `migracoes_aplicadas`; na primeira execução registra as da versão atual como já aplicadas) → `up -d` (sem `--remove-orphans`)
  → teste da tela `/login` por 2 min → se falhar, volta a imagem anterior (as migrations só acrescentam).
- Aprovar a produção: Actions → a execução em andamento → **Review deployments** → `producao` → Approve.
- Rollback / versão específica: Actions → Deploy do CRM → Run workflow, com o SHA completo. (Passa pelo staging antes, se escolher `producao`.)
- Configuração única no GitHub: environments `staging` e `producao`; em `producao`, ligar **Required reviewers** (se o plano permitir).
- Secrets usados: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.
- O `deploy.yml` antigo (stack legada em `~/scrumboard-medguia`) continua existindo e é independente.

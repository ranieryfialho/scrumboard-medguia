// T-193 (fase4-whatsapp, AC-524/AC-528): o que a tela de configuração mostra do
// webhook, sem nunca expor o segredo. Os eventos são os mesmos que o CRM registra
// na Evolution (`setWebhook`).
import { origemDaRequisicao } from '../google/origem';

const HOST_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

/**
 * O endereço público do CRM que a Evolution deve chamar: o MESMO pelo qual a pessoa acessa a tela (cada ambiente registra o seu).
 * Não usa `NEXT_PUBLIC_APP_URL`: ela é gravada na imagem no build e a mesma imagem vale para o staging e para a produção — o staging
 * registrava o endereço de outro ambiente e as mensagens se perdiam (mesmo motivo de `lib/google/origem.ts`). Só rodando na própria
 * máquina (localhost, que a Evolution não alcança) cai no endereço configurado.
 */
export function appUrlDoWebhook(headers: Headers, urlDoPedido: URL): string {
  const origem = origemDaRequisicao(headers, urlDoPedido);
  if (!HOST_LOCAL.test(origem)) return origem;
  return process.env['APP_URL'] || process.env.NEXT_PUBLIC_APP_URL || origem;
}

export const EVENTOS_DO_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] as const;

export const SEGREDO_MASCARADO = '••••••••';

/** `<app>/api/whatsapp/webhook?empresa_id=<id>&secret=••••••••` — o segredo real nunca sai do servidor. */
export function urlDoWebhookMascarada(appUrl: string, empresaId: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/whatsapp/webhook?empresa_id=${empresaId}&secret=${SEGREDO_MASCARADO}`;
}

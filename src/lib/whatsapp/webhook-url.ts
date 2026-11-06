// T-193 (fase4-whatsapp, AC-524/AC-528): o que a tela de configuração mostra do
// webhook, sem nunca expor o segredo. Os eventos são os mesmos que o CRM registra
// na Evolution (`setWebhook`).
export const EVENTOS_DO_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] as const;

export const SEGREDO_MASCARADO = '••••••••';

/** `<app>/api/whatsapp/webhook?empresa_id=<id>&secret=••••••••` — o segredo real nunca sai do servidor. */
export function urlDoWebhookMascarada(appUrl: string, empresaId: string): string {
  return `${appUrl.replace(/\/$/, '')}/api/whatsapp/webhook?empresa_id=${empresaId}&secret=${SEGREDO_MASCARADO}`;
}

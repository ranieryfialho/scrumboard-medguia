import { EVENTOS_DO_WEBHOOK } from './whatsapp/webhook-url';

export interface EvolutionConfig {
  url: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionSendResult {
  key?: { id: string };
  error?: string;
  numberNotFound?: boolean;
}

/** Constrói config a partir de variáveis de ambiente + nome de instância */
export function buildConfig(instance: string): EvolutionConfig {
  return {
    url: process.env.EVOLUTION_API_URL!,
    apiKey: process.env.EVOLUTION_API_KEY!,
    instance,
  };
}

function base(config: EvolutionConfig) {
  return config.url.replace(/\/$/, '');
}

function normalizeNumber(numero: string): string {
  const digits = numero.replace(/\D/g, '');
  // Adiciona DDI 55 apenas para números brasileiros sem código de país (10-11 dígitos)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function sendTextMessage(
  config: EvolutionConfig,
  numero: string,
  texto: string
): Promise<EvolutionSendResult> {
  const normalized = normalizeNumber(numero);

  const trySend = async (num: string) => {
    return fetch(`${base(config)}/message/sendText/${config.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
      body: JSON.stringify({ number: num, text: texto }),
    });
  };

  let res = await trySend(normalized);

  // Se a validação falhou com "exists: false", tenta enviar direto pelo JID
  // (bypassa a verificação de existência da Evolution API)
  if (!res.ok) {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      const msg = parsed?.response?.message?.[0];
      if (msg?.exists === false) {
        // Tenta direto como JID (skip da validação)
        const jid = normalized.includes('@') ? normalized : `${normalized}@s.whatsapp.net`;
        res = await trySend(jid);
        if (res.ok) return await res.json();

        return {
          error: `Número ${msg.number} não encontrado no WhatsApp.`,
          numberNotFound: true,
        };
      }
    } catch {}
    return { error: `Evolution API erro ${res.status}: ${body}` };
  }

  return await res.json();
}

export async function getInstanceStatus(
  config: EvolutionConfig
): Promise<{ state?: string; instance?: { state?: string }; error?: string }> {
  try {
    const res = await fetch(
      `${base(config)}/instance/connectionState/${config.instance}`,
      { headers: { apikey: config.apiKey } }
    );

    if (!res.ok) return { error: `Erro ${res.status}` };
    return await res.json();
  } catch (err) {
    // Evolution fora do ar (conexão recusada, timeout etc.) — AC-177: quem
    // chama trata como desconectado, em vez de devolver um erro HTTP.
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/** Cria a instância se ainda não existir. Ignora erro 409 (já existe). */
export async function createInstance(config: EvolutionConfig): Promise<void> {
  const res = await fetch(`${base(config)}/instance/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({
      instanceName: config.instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    }),
  });

  // 409 = instância já existe, tudo bem
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    throw new Error(`Erro ao criar instância: ${body}`);
  }
}

/**
 * Configura o webhook da instância para receber mensagens. Devolve `true`
 * quando a Evolution aceitou o registro e `false` caso contrário (recusa ou
 * indisponibilidade) — quem chama decide o que fazer com a falha (AC-185:
 * não esconder o QR code, só avisar que a entrada não está ativa).
 */
export async function setWebhook(config: EvolutionConfig, webhookUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(config)}/webhook/set/${config.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: [...EVENTOS_DO_WEBHOOK],
        },
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/** Retorna o QR code em base64 ou { state: 'open' } se já conectado. */
export async function getQRCode(
  config: EvolutionConfig
): Promise<{ base64?: string; state?: string; error?: string }> {
  const res = await fetch(
    `${base(config)}/instance/connect/${config.instance}`,
    { headers: { apikey: config.apiKey }, cache: 'no-store' }
  );

  if (!res.ok) {
    const body = await res.text();
    return { error: `Erro ${res.status}: ${body}` };
  }

  const data = await res.json();
  if (data?.instance?.state === 'open') return { state: 'open' };
  return { base64: data?.base64 || data?.qrcode?.base64, state: data?.state };
}

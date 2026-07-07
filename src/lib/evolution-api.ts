export interface EvolutionConfig {
  url: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionSendResult {
  key?: { id: string };
  error?: string;
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
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

export async function sendTextMessage(
  config: EvolutionConfig,
  numero: string,
  texto: string
): Promise<EvolutionSendResult> {
  const res = await fetch(`${base(config)}/message/sendText/${config.instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({ number: normalizeNumber(numero), text: texto }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { error: `Evolution API erro ${res.status}: ${body}` };
  }

  return await res.json();
}

export async function getInstanceStatus(
  config: EvolutionConfig
): Promise<{ state?: string; instance?: { state?: string }; error?: string }> {
  const res = await fetch(
    `${base(config)}/instance/connectionState/${config.instance}`,
    { headers: { apikey: config.apiKey } }
  );

  if (!res.ok) return { error: `Erro ${res.status}` };
  return await res.json();
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

/** Configura o webhook da instância para receber mensagens. */
export async function setWebhook(config: EvolutionConfig, webhookUrl: string): Promise<void> {
  await fetch(`${base(config)}/webhook/set/${config.instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT'],
      },
    }),
  });
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

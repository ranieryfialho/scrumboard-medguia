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

/**
 * Faz o POST de um envio (áudio ou mídia) e traduz a resposta como `sendTextMessage`: erro vira `error`, e "esse número não
 * existe no WhatsApp" vira `numberNotFound`.
 */
async function postarEnvio(config: EvolutionConfig, caminho: string, corpo: Record<string, unknown>, numero: string): Promise<EvolutionSendResult> {
  const normalized = normalizeNumber(numero);
  const res = await fetch(`${base(config)}/message/${caminho}/${config.instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({ number: normalized, ...corpo }),
  });
  if (res.ok) return await res.json();
  const texto = await res.text();
  try {
    const msg = JSON.parse(texto)?.response?.message?.[0];
    if (msg?.exists === false) return { error: `Número ${msg.number} não encontrado no WhatsApp.`, numberNotFound: true };
  } catch {}
  return { error: `Evolution API erro ${res.status}: ${texto}` };
}

/** T-290 (AC-744): envia um áudio gravado como mensagem de voz; `base64` vai sem o prefixo `data:`. */
export function sendAudioMessage(config: EvolutionConfig, numero: string, base64: string): Promise<EvolutionSendResult> {
  return postarEnvio(config, 'sendWhatsAppAudio', { audio: base64 }, numero);
}

export interface MidiaParaEnvio {
  mediatype: 'image' | 'video' | 'document';
  mimetype: string;
  fileName: string;
  caption?: string;
  base64: string;
}

/** T-290 (AC-746): envia imagem, vídeo ou documento, com legenda opcional. */
export function sendMediaMessage(config: EvolutionConfig, numero: string, midia: MidiaParaEnvio): Promise<EvolutionSendResult> {
  const { base64, caption, ...resto } = midia;
  return postarEnvio(config, 'sendMedia', { ...resto, ...(caption ? { caption } : {}), media: base64 }, numero);
}

/** T-290 (AC-745): pede à Evolution o arquivo de uma mensagem que ela já guardou. `null` se ela não o tem mais. */
export async function fetchMediaBase64(config: EvolutionConfig, messageId: string): Promise<{ base64: string; mimetype: string | null } | null> {
  const res = await fetch(`${base(config)}/chat/getBase64FromMediaMessage/${config.instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
    body: JSON.stringify({ message: { key: { id: messageId } } }),
  });
  if (!res.ok) return null;
  const corpo = (await res.json().catch(() => null)) as { base64?: unknown; mimetype?: unknown } | null;
  if (!corpo || typeof corpo.base64 !== 'string' || corpo.base64 === '') return null;
  return { base64: corpo.base64.replace(/^data:[^,]*,/, ''), mimetype: typeof corpo.mimetype === 'string' ? corpo.mimetype : null };
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

/**
 * A instância já existe? Conforme a versão da Evolution, criar uma instância repetida volta 409 ou, na v2, 403 com "This name ... is already
 * in use". Nos dois casos está tudo certo: o que importa é que ela existe.
 */
export function instanciaJaExiste(status: number, corpo: string): boolean {
  if (status === 409) return true;
  return status === 403 && /already (in use|exists)/i.test(corpo);
}

/** Cria a instância se ainda não existir. Ignora "já existe" (409, ou 403 "already in use" da Evolution v2). */
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

  if (!res.ok) {
    const body = await res.text();
    if (instanciaJaExiste(res.status, body)) return;
    throw new Error(`Erro ao criar instância: ${body}`);
  }
}

/**
 * Reage (ou tira a reação, com `emoji` vazio) a uma mensagem. `fromMe` diz de quem é a mensagem reagida: `true` se foi a empresa que enviou.
 * Devolve `true` quando a Evolution aceitou.
 */
export async function sendReaction(
  config: EvolutionConfig,
  mensagem: { remoteJid: string; fromMe: boolean; id: string },
  emoji: string
): Promise<boolean> {
  try {
    const res = await fetch(`${base(config)}/message/sendReaction/${config.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
      body: JSON.stringify({ key: { remoteJid: mensagem.remoteJid, fromMe: mensagem.fromMe, id: mensagem.id }, reaction: emoji }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** URL (temporária) da foto de perfil do contato no WhatsApp; `null` quando não tem foto, está oculta pela privacidade ou a Evolution falhou. */
export async function fetchProfilePictureUrl(config: EvolutionConfig, numero: string): Promise<string | null> {
  try {
    const res = await fetch(`${base(config)}/chat/fetchProfilePictureUrl/${config.instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
      body: JSON.stringify({ number: numero }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const corpo = (await res.json().catch(() => null)) as { profilePictureUrl?: unknown } | null;
    return typeof corpo?.profilePictureUrl === 'string' && corpo.profilePictureUrl !== '' ? corpo.profilePictureUrl : null;
  } catch {
    return null;
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

/** T-304: encerra a sessão do WhatsApp da instância (o aparelho sai de "Aparelhos conectados"); a instância continua existindo. */
export async function logoutInstance(config: EvolutionConfig): Promise<boolean> {
  try {
    const res = await fetch(`${base(config)}/instance/logout/${config.instance}`, { method: 'DELETE', headers: { apikey: config.apiKey } });
    return res.ok;
  } catch {
    return false;
  }
}

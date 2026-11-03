// T-301 (fase4-tarefas-agenda, US-122, AC-765 a AC-770): o mínimo do Google que a agenda usa — conectar a conta da empresa (OAuth) e criar,
// mudar e apagar o evento de uma reunião no Calendar, com a sala do Meet. Sem biblioteca: são cinco chamadas HTTP. Os endereços do Google
// podem ser trocados por variáveis de ambiente (os testes apontam para um Google falso local).
//
// Permissões pedidas: `openid email` (para saber QUAL conta foi conectada) e `calendar.events` (criar e mudar eventos, nada além disso).

/** O cookie que guarda o código de segurança (state) entre ir ao Google e voltar dele. */
export const COOKIE_DO_STATE = 'crm_google_state';

const ESCOPOS = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];

export interface ConfigDoGoogle {
  clientId: string;
  clientSecret: string;
}

/** As credenciais do app no Google Cloud; `null` quando o servidor não as tem (a tela explica o que falta). */
export function configDoGoogle(ambiente: NodeJS.ProcessEnv = process.env): ConfigDoGoogle | null {
  const clientId = ambiente.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = ambiente.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const enderecos = (ambiente: NodeJS.ProcessEnv = process.env) => ({
  autorizacao: ambiente.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: ambiente.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  revogar: ambiente.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  api: (ambiente.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/$/, ''),
});

export class ErroDoGoogle extends Error {
  constructor(
    mensagem: string,
    public readonly status: number | null = null
  ) {
    super(mensagem);
    this.name = 'ErroDoGoogle';
  }
}

/** A URL para onde mandamos quem vai conectar a conta. `offline` + `consent` garantem que o Google devolva o refresh token. */
export function urlDeAutorizacao(config: ConfigDoGoogle, redirectUri: string, state: string, ambiente: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(enderecos(ambiente).autorizacao);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPOS.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  return url.toString();
}

async function postarFormulario(url: string, corpo: Record<string, string>): Promise<Record<string, unknown>> {
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corpo).toString(),
  });
  const json = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
  if (!resposta.ok || !json) throw new ErroDoGoogle(`O Google recusou a troca (${resposta.status}).`, resposta.status);
  return json;
}

/** O e-mail que vem dentro do `id_token` (recebido direto do Google, por HTTPS, na resposta da troca do código). */
function emailDoIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const carga = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: unknown };
    return typeof carga.email === 'string' ? carga.email : null;
  } catch {
    return null;
  }
}

/** Troca o `code` do retorno do Google pelos tokens; sem refresh token ou sem e-mail a conexão não vale. */
export async function trocarCodigo(config: ConfigDoGoogle, redirectUri: string, codigo: string): Promise<{ refreshToken: string; email: string }> {
  const json = await postarFormulario(enderecos().token, {
    code: codigo,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : null;
  const email = emailDoIdToken(json.id_token);
  if (!refreshToken || !email) throw new ErroDoGoogle('O Google não devolveu a permissão offline ou o e-mail da conta.');
  return { refreshToken, email };
}

export async function tokenDeAcesso(config: ConfigDoGoogle, refreshToken: string): Promise<string> {
  const json = await postarFormulario(enderecos().token, {
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  if (typeof json.access_token !== 'string') throw new ErroDoGoogle('O Google não devolveu o token de acesso.');
  return json.access_token;
}

/** Tira a permissão do app na conta (melhor esforço: se o Google não responder, a conexão local some do mesmo jeito). */
export async function revogar(refreshToken: string): Promise<void> {
  await fetch(enderecos().revogar, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  }).catch(() => undefined);
}

export interface DadosDoEvento {
  titulo: string;
  descricao: string;
  inicio: Date;
  fim: Date;
  /** E-mails convidados (o lead e o closer), já validados. */
  convidados: string[];
}

export interface EventoCriado {
  id: string;
  meetUrl: string | null;
}

const FUSO = 'America/Sao_Paulo';

function corpoDoEvento(d: DadosDoEvento) {
  return {
    summary: d.titulo,
    description: d.descricao,
    start: { dateTime: d.inicio.toISOString(), timeZone: FUSO },
    end: { dateTime: d.fim.toISOString(), timeZone: FUSO },
    attendees: d.convidados.map((email) => ({ email })),
  };
}

async function chamar(token: string, metodo: string, caminho: string, corpo?: unknown): Promise<Record<string, unknown> | null> {
  const resposta = await fetch(`${enderecos().api}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  // Apagar um evento que já não existe (404/410) é o resultado que queríamos.
  if (metodo === 'DELETE' && (resposta.ok || resposta.status === 404 || resposta.status === 410)) return null;
  if (!resposta.ok) throw new ErroDoGoogle(`O Google Calendar respondeu ${resposta.status}.`, resposta.status);
  return (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
}

/** Cria o evento com a sala do Meet e manda o convite por e-mail aos convidados (`sendUpdates=all`). */
export async function criarEvento(token: string, dados: DadosDoEvento, idDaSolicitacao: string): Promise<EventoCriado> {
  const json = await chamar(token, 'POST', '/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    ...corpoDoEvento(dados),
    conferenceData: { createRequest: { requestId: idDaSolicitacao, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
  });
  if (!json || typeof json.id !== 'string') throw new ErroDoGoogle('O Google não devolveu o evento criado.');
  return { id: json.id, meetUrl: typeof json.hangoutLink === 'string' ? json.hangoutLink : null };
}

/** Muda dia e hora do evento (a sala continua a mesma) e avisa os convidados. */
export async function remarcarEvento(token: string, eventoId: string, inicio: Date, fim: Date): Promise<void> {
  await chamar(token, 'PATCH', `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventoId)}?sendUpdates=all`, {
    start: { dateTime: inicio.toISOString(), timeZone: FUSO },
    end: { dateTime: fim.toISOString(), timeZone: FUSO },
  });
}

export async function apagarEvento(token: string, eventoId: string): Promise<void> {
  await chamar(token, 'DELETE', `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventoId)}?sendUpdates=all`);
}

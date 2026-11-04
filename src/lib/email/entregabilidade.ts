// T-309 (fase4-campanhas, US-130): confere no DNS os registros que o Gmail e o Outlook olham do remetente — SPF, DKIM e DMARC.
// Só leitura de DNS público; não prova que o e-mail chega, só que o domínio está configurado.
import { Resolver } from 'node:dns/promises';

export interface Entregabilidade {
  dominio: string | null;
  spf: boolean;
  dkim: boolean;
  dmarc: { achado: boolean; politica: string | null };
}

const SELETORES_DKIM = ['resend', 'google', 'default', 's1', 'selector1', 'k1', 'mail'];
const CACHE = new Map<string, { em: number; valor: Entregabilidade }>();
const CINCO_MINUTOS = 5 * 60_000;

/** O domínio do remetente: de `Nome <a@b.com>` ou `a@b.com`; `null` se não houver e-mail. */
export function dominioDoRemetente(remetente: string | null | undefined): string | null {
  const m = /([^<>@\s]+)@([^<>@\s]+\.[^<>@\s]+)>?\s*$/.exec((remetente ?? '').trim());
  return m ? m[2].toLowerCase() : null;
}

export async function verificarEntregabilidade(dominio: string | null, agora: number = Date.now()): Promise<Entregabilidade> {
  if (!dominio) return { dominio: null, spf: false, dkim: false, dmarc: { achado: false, politica: null } };
  const emCache = CACHE.get(dominio);
  if (emCache && agora - emCache.em < CINCO_MINUTOS) return emCache.valor;

  const dns = new Resolver({ timeout: 2500, tries: 1 });
  const txt = async (host: string) => dns.resolveTxt(host).then((r) => r.map((a) => a.join(''))).catch(() => [] as string[]);
  const cname = async (host: string) => dns.resolveCname(host).then((r) => r.length > 0).catch(() => false);

  // O Resend publica o SPF num subdomínio `send.`; o normal é no próprio domínio.
  const [spfRaiz, spfSend, dmarcTxt, ...dkims] = await Promise.all([
    txt(dominio),
    txt(`send.${dominio}`),
    txt(`_dmarc.${dominio}`),
    ...SELETORES_DKIM.map(async (s) => (await txt(`${s}._domainkey.${dominio}`)).some((t) => /v=DKIM1|p=/i.test(t)) || (await cname(`${s}._domainkey.${dominio}`))),
  ]);
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t));
  const valor: Entregabilidade = {
    dominio,
    spf: [...spfRaiz, ...spfSend].some((t) => /^v=spf1/i.test(t)),
    dkim: dkims.some(Boolean),
    dmarc: { achado: Boolean(dmarc), politica: dmarc ? (/;\s*p=([a-z]+)/i.exec(dmarc)?.[1]?.toLowerCase() ?? null) : null },
  };
  CACHE.set(dominio, { em: agora, valor });
  return valor;
}

// T-264 (fase5-email-disparo, US-171, AC-701/AC-703, ASM-267): o envio de UM e-mail de campanha pela API HTTP do Resend,
// com a chave e o remetente de cada empresa. O transporte é uma função injetável (os testes não chamam o Resend). Manda
// `from`, `to`, `subject`, `html`, os cabeçalhos de descadastro e as tags `envio_id` e `empresa_id` — as duas, porque o
// webhook do Resend as exige. A resposta é um resultado, nunca uma exceção: quem chama grava o motivo no envio.
const ENDPOINT_RESEND = 'https://api.resend.com/emails';
const REMETENTE_PADRAO = 'no-reply@medguia.cloud';

export type MotivoDeFalhaNoEnvio = 'RESEND_RECUSOU' | 'FALHA_DE_REDE';

export interface EmailDeCampanha {
  apiKey: string;
  remetente: string | null;
  /** T-307: para onde vão as respostas (Reply-To); ausente, o cliente responde ao próprio remetente. */
  replyTo?: string | null;
  destinatario: string;
  assunto: string;
  html: string;
  cabecalhos: Record<string, string>;
  envioId: string;
  empresaId: string;
}

export type ResultadoDoEnvioDeEmail = { ok: true } | { ok: false; erro: MotivoDeFalhaNoEnvio };
export type TransporteDeCampanha = (email: EmailDeCampanha) => Promise<ResultadoDoEnvioDeEmail>;

/** AC-703: resposta fora de 2xx vira `RESEND_RECUSOU`; falha de rede (ou de DNS, ou de tempo) vira `FALHA_DE_REDE`. */
export const transporteResendDeCampanha: TransporteDeCampanha = async (email) => {
  try {
    const resposta = await fetch(ENDPOINT_RESEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${email.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: email.remetente ?? process.env.RESEND_REMETENTE ?? REMETENTE_PADRAO,
        to: [email.destinatario],
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        subject: email.assunto,
        html: email.html,
        headers: email.cabecalhos,
        tags: [
          { name: 'envio_id', value: email.envioId },
          { name: 'empresa_id', value: email.empresaId },
        ],
      }),
    });
    return resposta.ok ? { ok: true } : { ok: false, erro: 'RESEND_RECUSOU' };
  } catch {
    return { ok: false, erro: 'FALHA_DE_REDE' };
  }
};

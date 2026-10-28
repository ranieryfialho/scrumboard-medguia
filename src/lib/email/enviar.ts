// T-142 (fase4-design-system-shell-acesso, US-100): envio de e-mail via
// Resend, com transporte injetável (o teste usa um falso, sem rede — nota
// da tarefa). A chamada HTTP é direta (API REST do Resend), sem depender do
// SDK oficial. AC-365 exige que o e-mail só saia quando a conta existe: em
// vez de este módulo reconsultar o banco, quem chama (T-145) passa `token`
// como `null` para a conta inexistente/inativa, e o envio é pulado aqui —
// a mesma regra que "nenhum e-mail é enviado" sem duplicar a consulta.
import { templateConvite, templateRedefinicaoSenha } from './templates';

export interface EmailParaEnviar {
  destinatario: string;
  assunto: string;
  html: string;
  texto: string;
}

export interface TransporteEmail {
  enviar(email: EmailParaEnviar): Promise<void>;
}

export class ErroRemetenteNaoConfigurado extends Error {
  constructor() {
    super('RESEND_API_KEY não configurada: envio de e-mail indisponível.');
    this.name = 'ErroRemetenteNaoConfigurado';
  }
}

export interface OpcoesTransporteResend {
  apiKey?: string;
  remetente?: string;
}

const ENDPOINT_RESEND = 'https://api.resend.com/emails';

/**
 * Transporte real via API do Resend (Q-043: chave, domínio e remetente).
 * Nasce sem a chave e falha com erro claro (`ErroRemetenteNaoConfigurado`)
 * se `RESEND_API_KEY` faltar no momento do envio.
 */
export function criarTransporteResend(opcoes: OpcoesTransporteResend = {}): TransporteEmail {
  return {
    async enviar(email: EmailParaEnviar): Promise<void> {
      const apiKey = opcoes.apiKey ?? process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new ErroRemetenteNaoConfigurado();
      }
      const remetente = opcoes.remetente ?? process.env.RESEND_REMETENTE ?? 'no-reply@medguia.cloud';

      const resposta = await fetch(ENDPOINT_RESEND, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: remetente,
          to: [email.destinatario],
          subject: email.assunto,
          html: email.html,
          text: email.texto,
        }),
      });

      if (!resposta.ok) {
        throw new Error(`Falha ao enviar e-mail pelo Resend (status ${resposta.status}).`);
      }
    },
  };
}

export interface EnviarEmailRedefinicaoSenhaOpcoes {
  transporte?: TransporteEmail;
  baseUrl?: string;
}

export interface EnviarEmailRedefinicaoSenhaResultado {
  enviado: boolean;
}

/**
 * Envia o e-mail de redefinição de senha (US-100).
 *
 * - AC-365: `token` é `null` para e-mail inexistente ou usuário inativo —
 *   nesse caso nenhum e-mail é enviado (nenhuma chamada ao transporte).
 *   Com token, envia o e-mail marcado MedCRM com o link do token.
 */
export async function enviarEmailRedefinicaoSenha(
  destinatario: string,
  token: string | null,
  opcoes: EnviarEmailRedefinicaoSenhaOpcoes = {}
): Promise<EnviarEmailRedefinicaoSenhaResultado> {
  if (!token) {
    return { enviado: false };
  }

  const transporte = opcoes.transporte ?? criarTransporteResend();
  const template = templateRedefinicaoSenha(token, { baseUrl: opcoes.baseUrl });

  await transporte.enviar({
    destinatario,
    assunto: template.assunto,
    html: template.html,
    texto: template.texto,
  });

  return { enviado: true };
}

export interface EnviarEmailConviteOpcoes {
  transporte?: TransporteEmail;
  baseUrl?: string;
  convidadoPor?: string;
}

/** AC-587: envia o e-mail de convite (MedCRM) com o link do token; quem chama trata a falha (`emailEnviado: false`). */
export async function enviarEmailConvite(destinatario: string, token: string, opcoes: EnviarEmailConviteOpcoes = {}): Promise<void> {
  const transporte = opcoes.transporte ?? criarTransporteResend();
  const template = templateConvite(token, { baseUrl: opcoes.baseUrl, convidadoPor: opcoes.convidadoPor });
  await transporte.enviar({ destinatario, assunto: template.assunto, html: template.html, texto: template.texto });
}

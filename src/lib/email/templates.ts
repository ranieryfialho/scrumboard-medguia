// T-142 (fase4-design-system-shell-acesso, US-100): template do e-mail de
// redefinição de senha, marcado MedCRM (AC-365). O link aponta para
// `/redefinir-senha/<token>` consumido por T-150; o prazo exibido (24h) é
// o mesmo do token em `reset-senha.ts` (TTL_RESET_MS).
export interface TemplateEmail {
  assunto: string;
  html: string;
  texto: string;
}

export interface OpcoesTemplateRedefinicaoSenha {
  baseUrl?: string;
}

function baseUrlPadrao(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.medguia.cloud';
}

/** AC-365: e-mail marcado MedCRM com o link de redefinição `/redefinir-senha/<token>`. */
export function templateRedefinicaoSenha(
  token: string,
  opcoes: OpcoesTemplateRedefinicaoSenha = {}
): TemplateEmail {
  const baseUrl = opcoes.baseUrl ?? baseUrlPadrao();
  const link = `${baseUrl}/redefinir-senha/${token}`;

  return {
    assunto: 'MedCRM — Redefinição de senha',
    html: `
      <p>Olá,</p>
      <p>Recebemos um pedido para redefinir a senha da sua conta <strong>MedCRM</strong>.</p>
      <p><a href="${link}">Clique aqui para criar uma nova senha</a></p>
      <p>Este link expira em 24 horas. Se você não pediu essa redefinição, pode ignorar este e-mail.</p>
      <p>MedCRM</p>
    `.trim(),
    texto: [
      'Olá,',
      'Recebemos um pedido para redefinir a senha da sua conta MedCRM.',
      `Para criar uma nova senha, acesse: ${link}`,
      'Este link expira em 24 horas. Se você não pediu essa redefinição, pode ignorar este e-mail.',
      'MedCRM',
    ].join('\n\n'),
  };
}

export interface OpcoesTemplateConvite {
  baseUrl?: string;
  /** Nome de quem convidou, para a primeira linha do e-mail. */
  convidadoPor?: string;
}

/** AC-587: e-mail de convite marcado MedCRM com o link `/convite/<token>` (prazo de 24 horas, ASM-205). */
export function templateConvite(token: string, opcoes: OpcoesTemplateConvite = {}): TemplateEmail {
  const baseUrl = opcoes.baseUrl ?? baseUrlPadrao();
  const link = `${baseUrl}/convite/${token}`;
  const quem = opcoes.convidadoPor ? `${opcoes.convidadoPor} convidou você` : 'Você foi convidado';

  return {
    assunto: 'MedCRM — Convite para entrar na equipe',
    html: `
      <p>Olá,</p>
      <p>${quem} para entrar na equipe no <strong>MedCRM</strong>.</p>
      <p><a href="${link}">Clique aqui para criar sua senha e entrar</a></p>
      <p>Este link expira em 24 horas e só pode ser usado uma vez.</p>
      <p>MedCRM</p>
    `.trim(),
    texto: [
      'Olá,',
      `${quem} para entrar na equipe no MedCRM.`,
      `Para criar sua senha e entrar, acesse: ${link}`,
      'Este link expira em 24 horas e só pode ser usado uma vez.',
      'MedCRM',
    ].join('\n\n'),
  };
}

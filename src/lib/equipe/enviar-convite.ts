// T-209/T-210/T-212 (fase4-admin, AC-587): envia o e-mail de convite sem nunca derrubar a
// criação — se o Resend não está configurado ou falha, o convite continua criado e quem
// convidou recebe o link para mandar à mão (`emailEnviado: false`, ASM-209).
import { enviarEmailConvite } from '../email/enviar';

export interface ResultadoDoEnvioDeConvite {
  emailEnviado: boolean;
  linkConvite: string;
}

export async function enviarConviteSemFalhar(
  email: string,
  token: string,
  baseUrl: string,
  convidadoPor?: string
): Promise<ResultadoDoEnvioDeConvite> {
  const linkConvite = `${baseUrl}/convite/${token}`;
  try {
    await enviarEmailConvite(email, token, { baseUrl, convidadoPor });
    return { emailEnviado: true, linkConvite };
  } catch {
    return { emailEnviado: false, linkConvite };
  }
}

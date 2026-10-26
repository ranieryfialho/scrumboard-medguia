// T-151 (fase4-design-system-shell-acesso, US-102): tela de convite — o
// cartão e o fundo vêm do layout do grupo `(auth)` (T-147); aqui só entra o
// formulário.
import { FormularioConvite } from '@/components/auth/formulario-convite';

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FormularioConvite token={token} />;
}

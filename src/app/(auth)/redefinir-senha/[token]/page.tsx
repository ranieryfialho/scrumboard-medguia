// T-150 (fase4-design-system-shell-acesso, US-101): tela de redefinir senha
// — o cartão e o fundo vêm do layout do grupo `(auth)` (T-147); aqui só
// entra o formulário.
import { FormularioRedefinirSenha } from '@/components/auth/formulario-redefinir-senha';

export default async function RedefinirSenhaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FormularioRedefinirSenha token={token} />;
}

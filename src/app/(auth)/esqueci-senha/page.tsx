// T-149 (fase4-design-system-shell-acesso, US-100): tela de "esqueci minha
// senha" — o cartão e o fundo vêm do layout do grupo `(auth)` (T-147); aqui
// só entra o formulário.
import { FormularioEsqueciSenha } from '@/components/auth/formulario-esqueci-senha';

export default function EsqueciSenhaPage() {
  return <FormularioEsqueciSenha />;
}

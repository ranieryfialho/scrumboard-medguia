// T-272 (fase5-email-descadastro, AC-715): moldura da página pública de descadastro — a mesma das telas de acesso, mas
// FORA do grupo `(auth)`: quem já está logado e clica no próprio link não é mandado para o pipeline.
import { MolduraAcesso } from '@/components/auth/moldura-acesso';

export default function DescadastroLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background-canvas">
      <MolduraAcesso>{children}</MolduraAcesso>
    </div>
  );
}

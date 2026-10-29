// T-272 (fase5-email-descadastro, AC-715): página pública de confirmação do descadastro.
import { Descadastro } from '@/components/email/descadastro';

export default async function DescadastroPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Descadastro token={token} />;
}

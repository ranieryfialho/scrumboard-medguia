// T-152 (fase4-design-system-shell-acesso, US-103): tela de sem acesso e
// sessão expirada — o cartão e o fundo vêm do layout do grupo `(auth)`
// (T-147); aqui só entra o painel. `PainelSemAcesso` lê `useSearchParams`
// (o `de` de AC-375), por isso precisa do limite do Next de ficar dentro de
// um `<Suspense>` (mesmo molde de `login/page.tsx`, T-148).
import { Suspense } from 'react';

import { PainelSemAcesso } from '@/components/auth/painel-sem-acesso';

export default function SemAcessoPage() {
  return (
    <Suspense fallback={null}>
      <PainelSemAcesso />
    </Suspense>
  );
}

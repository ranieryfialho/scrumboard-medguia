// T-148 (fase4-design-system-shell-acesso, US-099): tela de login — substitui
// a antiga `src/app/login/page.tsx` (Supabase do legado). O cartão e o fundo
// vêm do layout do grupo `(auth)` (T-147); aqui só entra o formulário.
// `FormularioLogin` lê `useSearchParams` (o `next` de AC-358), por isso
// precisa do limite do Next de ficar dentro de um `<Suspense>`.
import { Suspense } from 'react';

import { FormularioLogin } from '@/components/auth/formulario-login';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <FormularioLogin />
    </Suspense>
  );
}

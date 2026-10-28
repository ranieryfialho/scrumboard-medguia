// T-190 (fase4-whatsapp, AC-499): caixa de entrada do WhatsApp dentro da casca `(app)`.
import { Suspense } from 'react';

import { CaixaDeEntrada } from '@/components/whatsapp/caixa-de-entrada';

export default function WhatsappPage() {
  return (
    <Suspense fallback={null}>
      <CaixaDeEntrada />
    </Suspense>
  );
}

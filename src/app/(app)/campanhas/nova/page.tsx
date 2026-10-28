// T-198 (fase4-campanhas, AC-539): nova campanha e edição de rascunho dentro da casca `(app)`.
import { Suspense } from 'react';

import { NovaCampanha } from '@/components/campanhas/nova-campanha';

export default function NovaCampanhaPage() {
  return (
    <Suspense fallback={null}>
      <NovaCampanha />
    </Suspense>
  );
}

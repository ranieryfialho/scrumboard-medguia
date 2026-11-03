// T-301 (fase4-tarefas-agenda, AC-765): a tela do Google Meet da empresa dentro da casca `(app)`.
import { Suspense } from 'react';

import { GoogleMeetEmpresa } from '@/components/admin/google-meet-empresa';

export default function GoogleMeetPage() {
  return (
    <Suspense fallback={null}>
      <GoogleMeetEmpresa />
    </Suspense>
  );
}

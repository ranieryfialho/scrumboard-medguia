// T-311 (fase4-analises, US-133): relatório executivo dos indicadores, em página própria para imprimir ou salvar em PDF.
import { Suspense } from 'react';

import { RelatorioExecutivo } from '@/components/analises/relatorio-executivo';

export default function RelatorioExecutivoPage() {
  return (
    <Suspense fallback={null}>
      <RelatorioExecutivo />
    </Suspense>
  );
}

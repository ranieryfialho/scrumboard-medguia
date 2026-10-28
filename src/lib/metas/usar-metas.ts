'use client';

// T-222 (fase5-metas, ASM-215): as metas da empresa para os selos dos indicadores. Se a leitura
// falhar, devolve vazio — o indicador aparece sem selo, a tela não cai.
import { useEffect, useState } from 'react';

import type { MetasDaEmpresa } from './catalogo';

export function useMetas(): MetasDaEmpresa {
  const [metas, setMetas] = useState<MetasDaEmpresa>({});
  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const r = await fetch('/api/metas');
        if (!r?.ok) return;
        const corpo = (await r.json()) as { metas?: MetasDaEmpresa } | null;
        if (ativo && corpo?.metas) setMetas(corpo.metas);
      } catch {
        // sem metas, sem selo (ASM-215)
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);
  return metas;
}

'use client';

// T-147 (fase4-design-system-shell-acesso, US-099 a US-103): layout do
// grupo de rotas `(auth)` — as cinco telas de acesso (login, esqueci-senha,
// redefinir-senha, convite, sem-acesso). Mesmo molde do layout de `(app)`
// (`src/app/(app)/layout.tsx`, T-146): busca `GET /api/me` no cliente para
// decidir, em vez de reimplementar a resolução de sessão aqui.
//
// AC-362: quem já tem sessão válida e abre uma tela de acesso é levado
// direto para `/pipeline` — por isso nada é renderizado enquanto a sessão
// ainda está sendo checada (evita mostrar o formulário de login por um
// instante para quem já está logado).
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { MolduraAcesso } from '@/components/auth/moldura-acesso';

type EstadoSessao = 'verificando' | 'autenticado' | 'anonimo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoSessao>('verificando');

  useEffect(() => {
    let cancelado = false;

    fetch('/api/me')
      .then((resposta) => {
        if (cancelado) return;
        setEstado(resposta.ok ? 'autenticado' : 'anonimo');
      })
      .catch(() => {
        if (!cancelado) setEstado('anonimo');
      });

    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (estado === 'autenticado') router.replace('/pipeline');
  }, [estado, router]);

  if (estado !== 'anonimo') {
    return <div className="min-h-screen bg-background-canvas" />;
  }

  return (
    <div className="min-h-screen bg-background-canvas">
      <MolduraAcesso>{children}</MolduraAcesso>
    </div>
  );
}

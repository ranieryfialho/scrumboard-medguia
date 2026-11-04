'use client';

// T-146 (fase4-design-system-shell-acesso, US-098): layout do grupo de rotas
// `(app)` — a casca (menu lateral + topo) ao redor de todas as telas
// logadas. Busca `GET /api/me` (T-144, AC-383) no cliente para montar
// `MenuLateral`/`Topo`, igual ao `Sidebar` legado
// (`src/components/layout/sidebar.tsx`) já fazia com o Supabase — o
// `src/middleware.ts` garante que só quem tem sessão chega até aqui (senão
// vai para `/login` antes, AC-379), então aqui só falta os *dados* da
// sessão para renderizar. Mantém o estado da gaveta do menu no celular
// (AC-356): o botão de abrir mora no `Topo`, o `MenuLateral` é quem a
// fecha — por isso o estado vive aqui, no pai comum dos dois.
import { useEffect, useState } from 'react';

import { MenuLateral } from '@/components/shell/menu-lateral';
import { Topo, type UsuarioSessao } from '@/components/shell/topo';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [gavetaAberta, setGavetaAberta] = useState(false);

  useEffect(() => {
    let cancelado = false;

    fetch('/api/me')
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((dados) => {
        if (!cancelado) setUsuario(dados);
      })
      .catch(() => {
        if (!cancelado) setUsuario(null);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  if (!usuario) {
    return <div className="min-h-screen bg-background-canvas">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-background-canvas">
      <MenuLateral
        papel={usuario.papel}
        isSuperAdmin={usuario.isSuperAdmin}
        modulos={usuario.modulos}
        gavetaAberta={gavetaAberta}
        aoFecharGaveta={() => setGavetaAberta(false)}
      />
      <div className="md:pl-64">
        <Topo usuario={usuario} aoAbrirGaveta={() => setGavetaAberta(true)} />
        <main className="w-full min-h-[calc(100dvh-4rem)]">{children}</main>
      </div>
    </div>
  );
}

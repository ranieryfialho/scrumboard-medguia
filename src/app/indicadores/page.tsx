// T-103 (fase2d-kpis, US-063): rota própria `/indicadores` (AC-231). Mesmo
// padrão de src/app/tarefas/page.tsx — nenhum gate de sessão aqui: a tela só
// é alcançada depois do redirecionamento de login do src/middleware.ts, e o
// menu (src/components/layout/sidebar.tsx) já esconde o link para ATENDENTE.
import { PainelKpis } from "@/components/indicadores/painel-kpis";

export default function IndicadoresPage() {
  return (
    <main className="p-4 max-w-5xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Indicadores</h1>
      <PainelKpis />
    </main>
  );
}

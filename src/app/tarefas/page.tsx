// T-097 (fase2b-fila-tarefas, US-056): rota própria `/tarefas` (ASM-063).
// Mesmo padrão de src/app/pipeline/page.tsx — nenhum gate de sessão aqui:
// a tela só é alcançada depois do redirecionamento de login do
// src/middleware.ts (AC-204), e os dados vêm só da API (ASM-068).
import { FilaTarefas } from "@/components/tarefas/fila-tarefas";

export default function TarefasPage() {
  return (
    <main className="p-4 max-w-3xl mx-auto">
      <h1 className="text-lg font-semibold text-slate-800 mb-4">Minhas tarefas</h1>
      <FilaTarefas />
    </main>
  );
}

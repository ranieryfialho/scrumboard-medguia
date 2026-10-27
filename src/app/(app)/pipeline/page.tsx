// T-160 (fase4-pipeline-telas, US-106, AC-387): o funil Kanban vive no grupo
// `(app)` (`src/app/(app)/layout.tsx`, T-146) — a casca (menu com "Funil
// Pipeline" marcado, topo) vem de lá; esta página só entra como conteúdo. A
// URL continua `/pipeline` (a rota antiga, `src/app/pipeline/page.tsx`, foi
// removida — AC-415).
import { BoardKanban } from "@/components/pipeline/board-kanban";

export default function PipelinePage() {
  return <BoardKanban />;
}

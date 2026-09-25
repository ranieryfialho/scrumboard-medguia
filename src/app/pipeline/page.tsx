import { BoardKanban } from "@/components/pipeline/board-kanban";

export default function PipelinePage() {
  return (
    <main className="p-4 h-screen flex flex-col">
      <BoardKanban />
    </main>
  );
}

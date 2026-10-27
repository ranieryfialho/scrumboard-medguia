// T-159 (fase4-pipeline-telas, US-110, AC-416): aviso "tempo real
// desconectado" para o funil, a lista e os arquivados — some ao reconectar.
// Mesmo padrão visual do indicador de conexão do topo da casca
// (`src/components/shell/topo.tsx`, T-146), mas como banner inline (as
// telas do pipeline não têm uma barra fixa para um selo pequeno) e só
// aparece desconectado: quando conectado, a peça não renderiza nada.
import type { EstadoConexaoStream } from '@/hooks/use-stream-oportunidades';

interface AvisoTempoRealProps {
  estadoConexao: EstadoConexaoStream;
}

export function AvisoTempoReal({ estadoConexao }: AvisoTempoRealProps) {
  if (estadoConexao === 'conectado') return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning-surface border border-warning-border"
    >
      <span className="relative flex h-2 w-2">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-warning-text" />
      </span>
      <span className="font-label-sm text-label-sm text-warning-text font-semibold">
        Tempo real desconectado
      </span>
    </div>
  );
}

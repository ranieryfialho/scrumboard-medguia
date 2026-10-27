'use client';

// T-180 (fase4-pipeline-lote, US-118, AC-455/AC-456/AC-460): o botão "Exportar
// CSV" da lista e dos arquivados. Pede o arquivo com os MESMOS filtros (e aba)
// da tela, sem a página, e o entrega ao navegador como download. Mostra
// "Gerando..." enquanto espera e trata os motivos de recusa da API com mensagem:
// sem cards, acima do teto, sem permissão ou falha. Quem decide mostrar ou não o
// botão (só MASTER/GERENTE, AC-457) é a tela; a API confere de novo (403).
import { useState } from 'react';

interface BotaoExportarProps {
  /** Qual exportação: `lista` ou `arquivados` (a rota é `/api/oportunidades/<tela>/exportar`). */
  tela: 'lista' | 'arquivados';
  /** Os filtros da tela já em query string, SEM `pagina` nem `porPagina`. */
  consulta: string;
}

const MENSAGEM_DO_CODIGO: Record<string, string> = {
  NADA_PARA_EXPORTAR: 'Nenhum card para exportar com estes filtros.',
  LIMITE_EXCEDIDO: 'Muitos cards para exportar: refine os filtros.',
  SEM_PERMISSAO: 'Você não tem permissão para exportar.',
};

/** Nome do arquivo do cabeçalho `Content-Disposition`, ou um nome padrão com a tela. */
function nomeDoArquivo(resposta: Response, tela: string): string {
  const cabecalho = resposta.headers.get('content-disposition') ?? '';
  const achado = /filename="([^"]+)"/.exec(cabecalho);
  return achado ? achado[1] : `pipeline-${tela}.csv`;
}

export function BotaoExportar({ tela, consulta }: BotaoExportarProps) {
  const [gerando, setGerando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function exportar() {
    setGerando(true);
    setMensagem(null);
    try {
      const resposta = await fetch(`/api/oportunidades/${tela}/exportar${consulta ? `?${consulta}` : ''}`);
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
        setMensagem(MENSAGEM_DO_CODIGO[corpo?.codigo ?? ''] ?? 'Não foi possível exportar. Tente de novo.');
        return;
      }

      const blob = await resposta.blob();
      const endereco = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = endereco;
      link.download = nomeDoArquivo(resposta, tela);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(endereco);
    } catch {
      setMensagem('Não foi possível exportar. Tente de novo.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void exportar()}
        disabled={gerando}
        className="h-10 px-4 rounded-xl bg-surface-card hover:bg-surface-subtle shadow-sm flex items-center gap-2 font-label-md text-label-md font-semibold text-text-primary transition-colors disabled:opacity-60"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
          download
        </span>
        {gerando ? 'Gerando...' : 'Exportar CSV'}
      </button>
      {mensagem && (
        <p role="alert" className="font-body-sm text-body-sm text-danger-text">
          {mensagem}
        </p>
      )}
    </div>
  );
}

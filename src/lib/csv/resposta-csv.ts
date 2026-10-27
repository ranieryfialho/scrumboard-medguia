// T-179 (fase4-pipeline-lote, AC-455/AC-456): a resposta HTTP de um arquivo CSV
// (cabeçalhos de download, sem cache) e o nome do arquivo com a data do dia em
// São Paulo — compartilhados pelas duas rotas de exportação.

/** `AAAA-MM-DD` de hoje em `America/Sao_Paulo`. */
export function dataDeHojeParaArquivo(agora: Date = new Date()): string {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

export function respostaCsv(nomeDoArquivo: string, conteudo: string): Response {
  return new Response(conteudo, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomeDoArquivo}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// T-271 (fase5-email-descadastro, AC-720): o rodapé de descadastro no corpo do e-mail e os cabeçalhos
// `List-Unsubscribe` (RFC 8058: um clique pelo Gmail e outros). Função pura.
export const TEXTO_DO_RODAPE = 'Para deixar de receber estes e-mails, clique aqui';

/** O rodapé entra no fim do HTML (antes de `</body>`, quando existir); se o link já está no corpo, não repete. */
export function prepararCorpoComDescadastro(corpoHtml: string, link: string): string {
  if (corpoHtml.includes(link)) return corpoHtml;
  const rodape = `<p style="font-size:12px;color:#6b7280;text-align:center;margin-top:24px">${TEXTO_DO_RODAPE.replace('clique aqui', `<a href="${link}">clique aqui</a>`)}.</p>`;
  const fim = corpoHtml.search(/<\/body\s*>/i);
  return fim === -1 ? `${corpoHtml}${rodape}` : `${corpoHtml.slice(0, fim)}${rodape}${corpoHtml.slice(fim)}`;
}

/** Os cabeçalhos do e-mail para o descadastro por um clique. */
export function cabecalhosDeDescadastro(link: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

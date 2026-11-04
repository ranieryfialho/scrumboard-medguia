// T-309 (fase4-campanhas, US-130): as verificações do "Checklist de Qualidade do Disparo" que dependem só do texto do e-mail.
// Funções puras: a tela chama a cada digitação. Não prometem entrega — apontam o que costuma dar problema.
const VARIAVEIS_CONHECIDAS = new Set(['nome', 'primeiro_nome']);

/** Variáveis `{{...}}` que o envio não conhece (ficariam como estão no e-mail do destinatário). */
export function variaveisDesconhecidas(corpoHtml: string): string[] {
  const achadas = new Set<string>();
  for (const m of corpoHtml.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (!VARIAVEIS_CONHECIDAS.has(m[1].toLowerCase())) achadas.add(m[1]);
  }
  return [...achadas];
}

const PALAVRAS_DE_SPAM = ['gratis', 'ganhe dinheiro', 'compre ja', 'clique aqui agora', 'oferta imperdivel', '100% garantido', 'sem compromisso', 'dinheiro facil'];
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pontos de atenção do assunto e do corpo que costumam levar a e-mail para o spam. Lista vazia = nada encontrado. */
export function pontosDeAtencao(assunto: string, corpoHtml: string): string[] {
  const pontos: string[] = [];
  const a = assunto.trim();
  if (a) {
    const letras = a.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const maiusculas = letras.replace(/[^A-ZÀ-Ý]/g, '').length;
    if (letras.length >= 8 && maiusculas / letras.length > 0.6) pontos.push('O assunto está quase todo em MAIÚSCULAS.');
    if (/[!?]{3,}|!.*!.*!/.test(a)) pontos.push('O assunto tem exclamações demais.');
    if (a.length > 80) pontos.push('O assunto passa de 80 caracteres e será cortado na caixa de entrada.');
    const achada = PALAVRAS_DE_SPAM.find((p) => semAcento(a).includes(p));
    if (achada) pontos.push(`O assunto usa uma expressão típica de spam ("${achada}").`);
  }
  if (corpoHtml.trim()) {
    if (corpoHtml.length > 100 * 1024) pontos.push('O HTML passa de 100 KB: o Gmail corta e esconde o fim do e-mail.');
    const imagensSemAlt = [...corpoHtml.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;
    if (imagensSemAlt > 0) pontos.push(`${imagensSemAlt} ${imagensSemAlt === 1 ? 'imagem sem' : 'imagens sem'} texto alternativo (alt).`);
    const incompletos = [...corpoHtml.matchAll(/href\s*=\s*["']\s*(https?:\/\/)?\s*#?["']/gi)].length;
    if (incompletos > 0) pontos.push(`${incompletos} ${incompletos === 1 ? 'link' : 'links'} sem endereço (href vazio ou só "https://").`);
    const texto = corpoHtml.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (texto.length < 20) pontos.push('O e-mail tem quase nenhum texto (só imagem ou HTML vazio).');
  }
  return pontos;
}

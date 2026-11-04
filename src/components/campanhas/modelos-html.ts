// T-306 (fase4-campanhas, US-130): os modelos de e-mail, os trechos da barra de formatação e o pré-cabeçalho. Funções e textos puros.
const ENVOLTORIO = (titulo: string, corpo: string, botao: string) => `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;">
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:22px;color:#0b5ed7;">${titulo}</h1>
${corpo}
          <a href="https://" style="display:inline-block;padding:12px 20px;background:#0b5ed7;color:#ffffff;text-decoration:none;border-radius:8px;">${botao}</a>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const P = (texto: string) => `          <p style="margin:0 0 16px;line-height:1.6;">${texto}</p>`;

export const MODELO_BASICO = ENVOLTORIO(
  'Olá, {{primeiro_nome}}!',
  P('Escreva aqui a mensagem da campanha. Você pode usar tabelas, imagens por link e estilos em linha.'),
  'Saiba mais'
);

export const MODELOS: { id: string; rotulo: string; html: string }[] = [
  {
    id: 'institucional',
    rotulo: 'Institucional',
    html: ENVOLTORIO(
      'Olá, {{primeiro_nome}}, conheça o MedCRM',
      `${P('O MedCRM organiza o relacionamento da sua clínica: do primeiro contato ao fechamento, com cadência, agenda e WhatsApp em um só lugar.')}\n${P('Agende uma conversa rápida e veja como funciona na prática.')}`,
      'Agendar uma conversa'
    ),
  },
  {
    id: 'tiss',
    rotulo: 'TISS & Propostas',
    html: ENVOLTORIO(
      '{{primeiro_nome}}, atualização importante para sua clínica',
      `${P('Preparamos um resumo das mudanças do padrão TISS e uma proposta ajustada para a rotina de faturamento da sua clínica.')}\n${P('Os pontos principais estão no material abaixo.')}`,
      'Ver a proposta'
    ),
  },
  {
    id: 'reativacao',
    rotulo: 'Reativação',
    html: ENVOLTORIO(
      'Sentimos sua falta, {{primeiro_nome}}',
      `${P('Faz um tempo que não conversamos. Desde então, o MedCRM ganhou novidades que podem ajudar a sua clínica.')}\n${P('Que tal retomar de onde paramos? Temos uma condição especial para quem volta.')}`,
      'Retomar agora'
    ),
  },
];

/** Trechos da barra de formatação; `%` marca onde o cursor fica (ou o texto selecionado entra). */
export const TRECHOS: { id: string; rotulo: string; icone: string; abre: string; fecha: string; padrao: string }[] = [
  { id: 'h1', rotulo: 'Título', icone: 'title', abre: '<h2 style="margin:0 0 16px;font-size:20px;color:#0b5ed7;">', fecha: '</h2>', padrao: 'Título' },
  { id: 'p', rotulo: 'Parágrafo', icone: 'notes', abre: '<p style="margin:0 0 16px;line-height:1.6;">', fecha: '</p>', padrao: 'Texto do parágrafo' },
  { id: 'b', rotulo: 'Negrito', icone: 'format_bold', abre: '<strong>', fecha: '</strong>', padrao: 'texto' },
  { id: 'i', rotulo: 'Itálico', icone: 'format_italic', abre: '<em>', fecha: '</em>', padrao: 'texto' },
  { id: 'a', rotulo: 'Link', icone: 'link', abre: '<a href="https://" style="color:#0b5ed7;">', fecha: '</a>', padrao: 'texto do link' },
  { id: 'btn', rotulo: 'Botão', icone: 'smart_button', abre: '<a href="https://" style="display:inline-block;padding:12px 20px;background:#0b5ed7;color:#ffffff;text-decoration:none;border-radius:8px;">', fecha: '</a>', padrao: 'Saiba mais' },
  { id: 'img', rotulo: 'Imagem', icone: 'image', abre: '<img src="https://" alt="', fecha: '" width="100%" style="display:block;border-radius:8px;">', padrao: 'descrição da imagem' },
  { id: 'ul', rotulo: 'Lista', icone: 'format_list_bulleted', abre: '<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;"><li>', fecha: '</li></ul>', padrao: 'item' },
  { id: 'hr', rotulo: 'Divisor', icone: 'horizontal_rule', abre: '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">', fecha: '', padrao: '' },
];

/** Aplica um trecho sobre `texto` entre `inicio` e `fim` (a seleção); devolve o novo texto e onde o cursor fica. */
export function aplicarTrecho(texto: string, inicio: number, fim: number, trecho: { abre: string; fecha: string; padrao: string }): { texto: string; cursor: number } {
  const miolo = texto.slice(inicio, fim) || trecho.padrao;
  const inserido = `${trecho.abre}${miolo}${trecho.fecha}`;
  return { texto: texto.slice(0, inicio) + inserido + texto.slice(fim), cursor: inicio + inserido.length };
}

const PRECABECALHO = /<div data-precabecalho[^>]*>([\s\S]*?)<\/div>/i;

/** O texto de pré-cabeçalho que já está no HTML ('' se não houver). */
export function lerPrecabecalho(html: string): string {
  const m = PRECABECALHO.exec(html);
  return m ? m[1].replace(/&nbsp;|&zwnj;|‌| /g, ' ').trim() : '';
}

/** Põe (ou troca, ou tira) o pré-cabeçalho: um bloco escondido logo depois de `<body>` — o texto que o cliente de e-mail mostra ao lado do assunto. */
export function definirPrecabecalho(html: string, texto: string): string {
  const limpo = texto.replace(/[<>]/g, '').trim();
  const bloco = limpo ? `<div data-precabecalho style="display:none;max-height:0;overflow:hidden;opacity:0;">${limpo}</div>` : '';
  if (PRECABECALHO.test(html)) return html.replace(PRECABECALHO, bloco);
  if (!bloco) return html;
  const corpo = /<body[^>]*>/i.exec(html);
  if (corpo) return html.slice(0, corpo.index + corpo[0].length) + bloco + html.slice(corpo.index + corpo[0].length);
  return bloco + html;
}

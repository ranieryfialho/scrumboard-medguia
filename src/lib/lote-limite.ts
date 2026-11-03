// T-296: o teto de cards por pedido de lote, num arquivo sem dependência de servidor para a tela também poder importá-lo
// (`src/repositories/lote-oportunidades.ts` re-exporta este mesmo valor).
export const LIMITE_DE_IDS_POR_LOTE = 100;

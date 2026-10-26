// T-152 (fase4-design-system-shell-acesso, US-103): nome legível de uma
// rota, usado pela tela de sem acesso (AC-375) para mostrar o "Recurso
// Solicitado" em português em vez do caminho técnico. Reaproveita os
// rótulos já definidos no menu da casca (`menu-config.ts`, T-146) em vez de
// duplicá-los — esta tarefa importa aquele arquivo, não o altera.
import { GRUPOS_MENU } from '@/components/shell/menu-config';

/**
 * AC-375: para uma rota que o menu conhece, devolve o rótulo do item
 * ("/indicadores" → "Indicadores"); para uma rota que o sistema não
 * conhece, devolve o próprio caminho, tal como veio.
 */
export function nomeLegivelDaRota(caminho: string): string {
  for (const grupo of GRUPOS_MENU) {
    for (const item of grupo.itens) {
      if (item.href === caminho) return item.rotulo;
    }
  }
  return caminho;
}

// T-088 (fase2b-cadencia, US-052): matriz canônica de 18 toques em 3 dias
// (PRD §5.2 / TDD-001 §4.5) — 6 blocos de 3 atividades, sem I/O.
import type { Turno } from './turno';

export type Dia = 1 | 2 | 3;
export type Canal = 'telefone' | 'whatsapp';
export type TipoToque = 'ligacao' | 'mensagem' | 'breakup';

export interface ToqueDaMatriz {
  sequencia: number; // 1-18
  dia: Dia;
  turno: Turno;
  canal: Canal;
  tipo: TipoToque;
}

const BLOCOS: ReadonlyArray<{ dia: Dia; turno: Turno }> = [
  { dia: 1, turno: 'manha' },
  { dia: 1, turno: 'tarde' },
  { dia: 2, turno: 'manha' },
  { dia: 2, turno: 'tarde' },
  { dia: 3, turno: 'manha' },
  { dia: 3, turno: 'tarde' },
];

/** AC-187: devolve os 3 toques do bloco (dia, turno), sequências 1–18 contíguas; o 18º é `breakup`. */
export function blocoDe(dia: Dia, turno: Turno): ToqueDaMatriz[] {
  const indiceBloco = BLOCOS.findIndex((bloco) => bloco.dia === dia && bloco.turno === turno);
  if (indiceBloco === -1) {
    throw new Error(`Bloco inexistente na matriz: dia ${dia}, turno ${turno}`);
  }

  const primeiraSequencia = indiceBloco * 3 + 1;
  const eUltimoBloco = indiceBloco === BLOCOS.length - 1;

  return [0, 1, 2].map((posicao) => {
    const eToqueDeWhatsapp = posicao === 2;
    const eUltimoToqueDaMatriz = eUltimoBloco && eToqueDeWhatsapp;

    let tipo: TipoToque;
    if (eUltimoToqueDaMatriz) tipo = 'breakup';
    else if (eToqueDeWhatsapp) tipo = 'mensagem';
    else tipo = 'ligacao';

    return {
      sequencia: primeiraSequencia + posicao,
      dia,
      turno,
      canal: eToqueDeWhatsapp ? 'whatsapp' : 'telefone',
      tipo,
    };
  });
}

'use client';

// T-146 (fase4-design-system-shell-acesso, US-098): contadores reais do menu
// lateral (AC-351) — toques pendentes do turno e atrasados vêm de
// `GET /api/atividades?atrasados=1` (mesma rota e resposta `{itens}` que
// `src/components/tarefas/fila-tarefas.tsx` já consome, diferenciados pelo
// campo `atrasado`); WhatsApp não lidas vem de `GET /api/whatsapp/unread`
// (`{conversas}`). AC-351: contagem zero ou a consulta falhando vira
// `undefined` — nunca 0 nem um número inventado — para o menu esconder o
// selo em vez de mostrá-lo errado.
import { useEffect, useState } from 'react';

export interface Contadores {
  tarefasDoTurno?: number;
  tarefasAtrasadas?: number;
  whatsappNaoLidas?: number;
}

interface ItemAtividade {
  atrasado: boolean;
}

/** `0` e contagem ausente (falha) colapsam no mesmo `undefined` — quem usa o hook não distingue, nem precisa (AC-351). */
function comoContadorVisivel(total: number): number | undefined {
  return total > 0 ? total : undefined;
}

/** Evento do navegador que faz o menu reler o contador de mensagens não lidas (T-174, AC-440). */
export const EVENTO_CONTADORES_MUDARAM = 'crm:contadores-mudaram';

async function carregarContadoresTarefas(): Promise<Pick<Contadores, 'tarefasDoTurno' | 'tarefasAtrasadas'>> {
  try {
    const resposta = await fetch('/api/atividades?atrasados=1');
    if (!resposta.ok) return {};
    const corpo = await resposta.json();
    const itens = (corpo.itens ?? []) as ItemAtividade[];
    return {
      tarefasDoTurno: comoContadorVisivel(itens.filter((item) => !item.atrasado).length),
      tarefasAtrasadas: comoContadorVisivel(itens.filter((item) => item.atrasado).length),
    };
  } catch {
    return {};
  }
}

async function carregarContadorWhatsapp(): Promise<Pick<Contadores, 'whatsappNaoLidas'>> {
  try {
    const resposta = await fetch('/api/whatsapp/unread');
    if (!resposta.ok) return {};
    const corpo = await resposta.json();
    const conversas = (corpo.conversas ?? []) as unknown[];
    return { whatsappNaoLidas: comoContadorVisivel(conversas.length) };
  } catch {
    return {};
  }
}

/** AC-351: números reais do menu — sem contador inventado em caso de erro ou zero. */
export function useContadores(): Contadores {
  const [contadores, setContadores] = useState<Contadores>({});

  useEffect(() => {
    let cancelado = false;

    Promise.all([carregarContadoresTarefas(), carregarContadorWhatsapp()]).then(([tarefas, whatsapp]) => {
      if (cancelado) return;
      setContadores({ ...tarefas, ...whatsapp });
    });

    // T-174 (AC-440): quem mexe nas mensagens (ex.: abrir a conversa de um lead
    // marca as recebidas como lidas) avisa o menu, que refaz só o número do WhatsApp.
    function aoMudarWhatsapp() {
      void carregarContadorWhatsapp().then((whatsapp) => {
        if (!cancelado) setContadores((atual) => ({ ...atual, ...whatsapp }));
      });
    }
    window.addEventListener(EVENTO_CONTADORES_MUDARAM, aoMudarWhatsapp);

    // T-297 (AC-761): os números de tarefas acompanham a fila — quem conclui, inicia ou vira o dia (esta aba, outra aba, outra
    // pessoa) faz o servidor emitir `cadencia.fila_alterada`, e o menu relê só os dois contadores de tarefas. Sem `EventSource`
    // (testes, navegadores antigos) o menu segue como antes: lê ao abrir.
    function aoMudarFila() {
      void carregarContadoresTarefas().then((tarefas) => {
        if (!cancelado) setContadores((atual) => ({ ...atual, ...tarefas }));
      });
    }
    const fila = typeof EventSource === 'undefined' ? null : new EventSource('/api/stream');
    fila?.addEventListener('cadencia.fila_alterada', aoMudarFila);
    fila?.addEventListener('stream.reconectado', aoMudarFila);

    return () => {
      cancelado = true;
      window.removeEventListener(EVENTO_CONTADORES_MUDARAM, aoMudarWhatsapp);
      fila?.close();
    };
  }, []);

  return contadores;
}

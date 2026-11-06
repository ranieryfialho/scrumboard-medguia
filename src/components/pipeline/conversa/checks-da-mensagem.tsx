import { Check, CheckCheck } from 'lucide-react';

import { statusDaMensagem, type StatusDaMensagem } from './formatos';

const ROTULO: Record<StatusDaMensagem, string> = { enviada: 'Enviada', entregue: 'Entregue', lida: 'Lida' };

/**
 * Os checks do WhatsApp numa mensagem enviada: um check = enviada, dois = entregue, dois azuis = lida.
 * O balão de quem envia é azul, então "lida" usa um azul-claro vivo (o azul do WhatsApp sumiria no fundo) e os demais ficam esmaecidos.
 */
export function ChecksDaMensagem({ status }: { status: string }) {
  const atual = statusDaMensagem(status);
  const Icone = atual === 'enviada' ? Check : CheckCheck;
  return (
    <span
      data-status={atual}
      title={ROTULO[atual]}
      className={`inline-flex align-middle ml-1 ${atual === 'lida' ? 'text-sky-300' : 'opacity-80'}`}
    >
      <Icone aria-hidden="true" className="size-[15px]" strokeWidth={2.25} />
      <span className="sr-only">{ROTULO[atual]}</span>
    </span>
  );
}

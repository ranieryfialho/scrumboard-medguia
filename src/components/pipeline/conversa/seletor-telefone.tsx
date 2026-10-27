'use client';

// T-174 (fase4-card-abas, US-114, AC-438): o seletor de telefone do topo da
// conversa — principal e extras do lead, cada número com o rótulo.
import { rotuloDoTelefone, type TelefoneDoLead } from './formatos';

interface SeletorTelefoneProps {
  telefones: TelefoneDoLead[];
  /** Índice do telefone escolhido na lista. */
  escolhido: number;
  onEscolher: (indice: number) => void;
}

export function SeletorTelefone({ telefones, escolhido, onEscolher }: SeletorTelefoneProps) {
  if (telefones.length === 0) return null;

  return (
    <div className="relative">
      <label htmlFor="conversa-telefone" className="sr-only">
        Telefone da conversa
      </label>
      <select
        id="conversa-telefone"
        value={escolhido}
        onChange={(evento) => onEscolher(Number(evento.target.value))}
        className="h-10 pl-3 pr-8 rounded-xl bg-surface-subtle text-text-primary font-label-lg text-label-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {telefones.map((telefone, indice) => (
          <option key={`${telefone.numero}-${telefone.id ?? 'principal'}`} value={indice}>
            {rotuloDoTelefone(telefone)}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]"
      >
        expand_more
      </span>
    </div>
  );
}

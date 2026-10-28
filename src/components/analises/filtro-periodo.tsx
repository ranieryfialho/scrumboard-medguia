'use client';

// T-204 (fase4-analises, AC-556/AC-564/AC-568): os botões de período pronto das três
// telas de análises. Quem escolhe o que fazer com o período é a tela.
import { ROTULO_DO_PRESET, type Preset } from './comum';

interface FiltroPeriodoProps {
  valor: Preset;
  presets: Preset[];
  onMudar: (preset: Preset) => void;
}

export function FiltroPeriodo({ valor, presets, onMudar }: FiltroPeriodoProps) {
  return (
    <div role="group" aria-label="Período" className="flex items-center gap-1 rounded-xl bg-surface-subtle p-1 flex-wrap">
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={valor === p}
          onClick={() => onMudar(p)}
          className={`h-8 px-3 rounded-lg font-label-md text-label-md ${valor === p ? 'bg-surface-card text-primary font-semibold shadow-sm' : 'text-text-secondary'}`}
        >
          {ROTULO_DO_PRESET[p]}
        </button>
      ))}
    </div>
  );
}

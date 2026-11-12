'use client';

// T-204 (fase4-analises, AC-556/AC-564/AC-568): os botões de período pronto das telas de análises. Quem escolhe o que fazer
// com o período é a tela.
// fase6-periodo-personalizado (US-190, AC-800/AC-802): o botão "Personalizado" abre os campos De e Até; o intervalo só vale
// ao clicar em "Aplicar" e é barrado aqui mesmo quando inválido, sem avisar a tela (e, portanto, sem pedir nada ao servidor).
// `compacto` é o jeito de painel (botões em duas colunas, campos lado a lado) usado dentro do pop-up do pipeline; sem ele, os
// botões ficam numa linha e os campos aparecem numa linha própria logo abaixo, sem empurrar os outros filtros da barra.
import { useState } from 'react';

import { periodoDe, periodoPronto, ROTULO_DO_PRESET, validarIntervalo, type PeriodoEscolhido, type Preset } from './comum';

interface FiltroPeriodoProps {
  /** `null` = nenhum período escolhido (nada marcado; o Personalizado abre com os últimos 30 dias). */
  valor: PeriodoEscolhido | null;
  presets: Preset[];
  onMudar: (periodo: PeriodoEscolhido) => void;
  /** Desliga o "Personalizado" onde o período só pode ser um dos prontos. */
  semPersonalizado?: boolean;
  compacto?: boolean;
}

const CLASSE_CAMPO = 'h-9 w-full min-w-0 px-2 rounded-lg bg-surface-card border border-border-subtle font-label-md text-label-md text-text-primary';

export function FiltroPeriodo({ valor, presets, onMudar, semPersonalizado = false, compacto = false }: FiltroPeriodoProps) {
  const [aberto, setAberto] = useState(valor?.tipo === 'personalizado');
  const inicial = periodoDe(valor ?? periodoPronto('30dias'));
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);
  const [erro, setErro] = useState<string | null>(null);

  function abrirPersonalizado() {
    const atual = periodoDe(valor ?? periodoPronto('30dias'));
    setDe(atual.de);
    setAte(atual.ate);
    setErro(null);
    setAberto(true);
  }

  function escolherPronto(preset: Preset) {
    setAberto(false);
    setErro(null);
    onMudar(periodoPronto(preset));
  }

  function aplicar() {
    const mensagem = validarIntervalo(de, ate);
    setErro(mensagem);
    if (mensagem) return;
    onMudar({ tipo: 'personalizado', de, ate });
  }

  const pronto = valor?.tipo === 'preset' ? valor.preset : null;
  const classeBotao = (marcado: boolean) =>
    `h-8 px-3 rounded-lg font-label-md text-label-md whitespace-nowrap ${compacto ? 'justify-center' : ''} ${marcado ? 'bg-surface-card text-primary font-semibold shadow-sm' : 'text-text-secondary'}`;

  return (
    <div className={`flex flex-col gap-2 ${compacto ? 'w-full' : 'items-start'}`}>
      <div role="group" aria-label="Período" className={compacto ? 'grid grid-cols-2 gap-1 rounded-xl bg-surface-subtle p-1' : 'flex items-center gap-1 rounded-xl bg-surface-subtle p-1 flex-wrap'}>
        {presets.map((p) => (
          <button key={p} type="button" aria-pressed={!aberto && pronto === p} onClick={() => escolherPronto(p)} className={classeBotao(!aberto && pronto === p)}>
            {ROTULO_DO_PRESET[p]}
          </button>
        ))}
        {!semPersonalizado && (
          <button type="button" aria-pressed={aberto} onClick={abrirPersonalizado} className={classeBotao(aberto)}>
            Personalizado
          </button>
        )}
      </div>
      {!semPersonalizado && aberto && (
        <div className={compacto ? 'grid grid-cols-2 gap-2' : 'flex items-end gap-2 flex-wrap'}>
          <label className="flex flex-col gap-1 font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
            De
            <input type="date" aria-label="De" value={de} onChange={(e) => setDe(e.target.value)} className={compacto ? CLASSE_CAMPO : `${CLASSE_CAMPO} w-40`} />
          </label>
          <label className="flex flex-col gap-1 font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
            Até
            <input type="date" aria-label="Até" value={ate} onChange={(e) => setAte(e.target.value)} className={compacto ? CLASSE_CAMPO : `${CLASSE_CAMPO} w-40`} />
          </label>
          <button type="button" onClick={aplicar} className={`h-9 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold ${compacto ? 'col-span-2' : ''}`}>
            Aplicar
          </button>
          {erro && (
            <span role="alert" className={`font-body-sm text-body-sm text-danger-text ${compacto ? 'col-span-2' : ''}`}>
              {erro}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

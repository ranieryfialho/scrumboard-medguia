'use client';

// T-204 (fase4-analises, AC-556/AC-564/AC-568): os botões de período pronto das telas de análises. Quem escolhe o que fazer
// com o período é a tela.
// fase6-periodo-personalizado (US-190, AC-800/AC-802): o botão "Personalizado" abre um painel com De e Até; o intervalo só vale
// ao clicar em "Aplicar" e é barrado aqui mesmo quando inválido, sem avisar a tela (e, portanto, sem pedir nada ao servidor).
// Os botões ficam sempre numa linha só: o painel flutua abaixo do "Personalizado" (não empurra os outros filtros da barra) e,
// com um intervalo aplicado, o próprio botão mostra as datas. `compacto` é o jeito de painel (botões em duas colunas e os
// campos já dentro do pop-up do pipeline), sem painel aninhado.
import { useEffect, useRef, useState } from 'react';

import { dataBr, periodoDe, periodoPronto, ROTULO_DO_PRESET, validarIntervalo, type PeriodoEscolhido, type Preset } from './comum';

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
const LARGURA_DO_PAINEL = 304; // 19rem

export function FiltroPeriodo({ valor, presets, onMudar, semPersonalizado = false, compacto = false }: FiltroPeriodoProps) {
  const [aberto, setAberto] = useState(compacto && valor?.tipo === 'personalizado');
  const inicial = periodoDe(valor ?? periodoPronto('30dias'));
  const [de, setDe] = useState(inicial.de);
  const [ate, setAte] = useState(inicial.ate);
  const [erro, setErro] = useState<string | null>(null);
  const [alinharADireita, setAlinharADireita] = useState(false);
  const raizDoPersonalizado = useRef<HTMLDivElement>(null);

  // Fora do modo compacto o painel é um pop-up: fecha ao clicar fora e com Esc.
  useEffect(() => {
    if (compacto || !aberto) return;
    const fora = (evento: MouseEvent) => {
      if (raizDoPersonalizado.current && !raizDoPersonalizado.current.contains(evento.target as Node)) setAberto(false);
    };
    const esc = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto, compacto]);

  function alternarPersonalizado() {
    if (aberto) {
      setAberto(false);
      return;
    }
    const atual = periodoDe(valor ?? periodoPronto('30dias'));
    setDe(atual.de);
    setAte(atual.ate);
    setErro(null);
    if (!compacto && raizDoPersonalizado.current) {
      setAlinharADireita(raizDoPersonalizado.current.getBoundingClientRect().left + LARGURA_DO_PAINEL > window.innerWidth - 16);
    }
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
    if (!compacto) setAberto(false);
  }

  const pronto = valor?.tipo === 'preset' ? valor.preset : null;
  const personalizadoMarcado = valor?.tipo === 'personalizado' || aberto;
  const classeBotao = (marcado: boolean) =>
    `h-8 px-3 rounded-lg font-label-md text-label-md whitespace-nowrap ${compacto ? 'justify-center' : ''} ${marcado ? 'bg-surface-card text-primary font-semibold shadow-sm' : 'text-text-secondary'}`;

  const campos = (
    <div className={compacto ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2'}>
      <label className="flex flex-col gap-1 font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
        De
        <input type="date" aria-label="De" value={de} onChange={(e) => setDe(e.target.value)} className={CLASSE_CAMPO} />
      </label>
      <label className="flex flex-col gap-1 font-label-sm text-label-sm text-text-muted uppercase tracking-wider">
        Até
        <input type="date" aria-label="Até" value={ate} onChange={(e) => setAte(e.target.value)} className={CLASSE_CAMPO} />
      </label>
      <button type="button" onClick={aplicar} className="col-span-2 h-9 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold">
        Aplicar
      </button>
      {erro && (
        <span role="alert" className="col-span-2 font-body-sm text-body-sm text-danger-text">
          {erro}
        </span>
      )}
    </div>
  );

  const rotuloDoPersonalizado = valor?.tipo === 'personalizado' ? `${dataBr(valor.de)} – ${dataBr(valor.ate)}` : 'Personalizado';

  return (
    <div className={`flex flex-col gap-2 ${compacto ? 'w-full' : 'items-start'}`}>
      <div role="group" aria-label="Período" className={compacto ? 'grid grid-cols-2 gap-1 rounded-xl bg-surface-subtle p-1' : 'flex items-center gap-1 rounded-xl bg-surface-subtle p-1 flex-wrap'}>
        {presets.map((p) => (
          <button key={p} type="button" aria-pressed={pronto === p} onClick={() => escolherPronto(p)} className={classeBotao(pronto === p)}>
            {ROTULO_DO_PRESET[p]}
          </button>
        ))}
        {!semPersonalizado && (
          <div className="relative" ref={raizDoPersonalizado}>
            <button type="button" aria-pressed={personalizadoMarcado} aria-expanded={aberto} onClick={alternarPersonalizado} className={`${classeBotao(personalizadoMarcado)} ${compacto ? 'w-full' : ''}`}>
              {rotuloDoPersonalizado}
            </button>
            {!compacto && aberto && (
              <div
                role="group"
                aria-label="Período personalizado"
                className={`absolute top-full z-30 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border-subtle bg-surface-card p-space-sm shadow-lg ${alinharADireita ? 'right-0' : 'left-0'}`}
              >
                {campos}
              </div>
            )}
          </div>
        )}
      </div>
      {!semPersonalizado && compacto && aberto && campos}
    </div>
  );
}

'use client';

// fase6-atendimento-lead (US-182, AC-789/AC-791): tela do horário de atendimento da empresa. Os sete dias da semana, cada um com
// "Atende" e os horários de abertura e fechamento; o relatório de marketing usa esse expediente para o "1º contato em horário
// comercial". Sem nada salvo, a tela mostra o padrão (segunda a sexta, 09:00 às 18:00). Quem valida é o servidor (400
// `HORARIO_INVALIDO`): a tela mostra a mensagem e o que valia continua valendo.
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DIAS_DA_SEMANA, type DiaDaSemana, type HorarioComercial } from '@/domain/atendimento/horario-comercial';
import { EsqueletoCarregando, EstadoErro } from './estados';
import { AvisoConfig, CabecalhoConfig, SecaoConfig } from './pecas-config';

/** Segunda primeiro, domingo por último (o padrão de agenda no Brasil). */
const ORDEM_NA_TELA: { dia: DiaDaSemana; nome: string }[] = [
  { dia: 'seg', nome: 'Segunda-feira' },
  { dia: 'ter', nome: 'Terça-feira' },
  { dia: 'qua', nome: 'Quarta-feira' },
  { dia: 'qui', nome: 'Quinta-feira' },
  { dia: 'sex', nome: 'Sexta-feira' },
  { dia: 'sab', nome: 'Sábado' },
  { dia: 'dom', nome: 'Domingo' },
];

const CLASSE_HORA =
  'h-10 w-28 px-2 rounded-xl bg-surface-subtle border border-transparent font-body-md text-body-md text-text-primary focus:outline-none focus:bg-surface-card focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-40';

interface Resposta {
  horario: HorarioComercial;
  padrao: boolean;
}

export function HorarioAtendimento() {
  const [horario, setHorario] = useState<HorarioComercial | null>(null);
  const [padrao, setPadrao] = useState(false);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/configuracoes/horario-atendimento');
      if (!r.ok) throw new Error(`horário respondeu ${r.status}`);
      const corpo = (await r.json()) as Resposta;
      setHorario(corpo.horario);
      setPadrao(corpo.padrao);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function mudar(dia: DiaDaSemana, patch: Partial<HorarioComercial[DiaDaSemana]>) {
    setHorario((atual) => (atual ? { ...atual, [dia]: { ...atual[dia], ...patch } } : atual));
    setAviso(null);
  }

  async function salvar() {
    if (!horario) return;
    setTrabalhando(true);
    try {
      const r = await fetch('/api/configuracoes/horario-atendimento', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ horario }) });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { mensagem?: string } | null;
        setAviso({ ok: false, texto: corpo?.mensagem ?? 'Não foi possível salvar o horário.' });
        return;
      }
      const corpo = (await r.json()) as Resposta;
      setHorario(corpo.horario);
      setPadrao(corpo.padrao);
      setAviso({ ok: true, texto: 'Horário salvo' });
    } finally {
      setTrabalhando(false);
    }
  }

  const diasQueAtende = horario ? DIAS_DA_SEMANA.filter((dia) => horario[dia].atende).length : 0;

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <CabecalhoConfig
        titulo="Horário de atendimento"
        descricao="Informe os dias e os horários em que a equipe atende. O relatório de marketing usa esse expediente para medir o tempo do 1º contato em horário comercial."
        acoes={
          horario && (
            <span className="h-10 px-4 rounded-xl bg-surface-card shadow-sm flex items-center gap-2 font-label-md text-label-md text-text-primary">
              <span aria-hidden="true" className="material-symbols-outlined text-[19px] text-primary">schedule</span>
              {diasQueAtende} {diasQueAtende === 1 ? 'dia' : 'dias'} de atendimento
            </span>
          )
        }
      />

      {erro && <EstadoErro mensagem="Não foi possível carregar o horário de atendimento." onTentarDeNovo={() => void carregar()} />}
      {!erro && !horario && <EsqueletoCarregando />}

      {horario && (
        <>
          <SecaoConfig nome="Expediente" rotulo="Semana" titulo="Expediente" icone="schedule">
            {padrao && <p className="font-body-sm text-body-sm text-text-muted">Ainda não há um horário salvo: esta é a sugestão padrão (segunda a sexta, das 09:00 às 18:00).</p>}
            <div className="flex flex-col">
              {ORDEM_NA_TELA.map(({ dia, nome }) => {
                const item = horario[dia];
                return (
                  <div key={dia} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border-subtle py-space-sm first:border-t-0 first:pt-0 last:pb-0">
                    <label className="flex items-center gap-3 font-label-md text-label-md text-text-primary min-w-[12rem]">
                      <input type="checkbox" aria-label={`Atende ${nome}`} checked={item.atende} onChange={(e) => mudar(dia, { atende: e.target.checked })} className="h-5 w-5 accent-primary" />
                      {nome}
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 font-body-sm text-body-sm text-text-muted">
                        Abre
                        <input type="time" aria-label={`Abre ${nome}`} value={item.abre} disabled={!item.atende} onChange={(e) => mudar(dia, { abre: e.target.value })} className={CLASSE_HORA} />
                      </label>
                      <label className="flex items-center gap-2 font-body-sm text-body-sm text-text-muted">
                        Fecha
                        <input type="time" aria-label={`Fecha ${nome}`} value={item.fecha} disabled={!item.atende} onChange={(e) => mudar(dia, { fecha: e.target.value })} className={CLASSE_HORA} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </SecaoConfig>
          <div className="bg-surface-card rounded-2xl shadow-sm p-space-md flex items-center gap-3 flex-wrap">
            <Button type="button" disabled={trabalhando} onClick={() => void salvar()}>
              Salvar horário
            </Button>
            <span className="font-body-sm text-body-sm text-text-muted">Feriados não são descontados: um dia marcado como &ldquo;Atende&rdquo; vale inteiro.</span>
            {aviso && <AvisoConfig ok={aviso.ok}>{aviso.texto}</AvisoConfig>}
          </div>
        </>
      )}
    </div>
  );
}

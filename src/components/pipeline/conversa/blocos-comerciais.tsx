'use client';

// T-289 (fase4-card-abas, US-114, AC-742/AC-743): os blocos "Dados da Proposta" e "Qualificação Técnica" da coluna da direita da
// conversa — fonte visual `11._pipeline_id_conversa_whatsapp_do_lead/`. Os dados vêm de `GET /api/oportunidades/:id/comercial`
// e cada bloco tem o próprio "Editar", que grava só o que mudou por `PUT` (a linha do tempo do card registra quem mudou o quê).
// O MRR ofertado é o valor estimado do card: editá-lo aqui usa o mesmo `PATCH /api/oportunidades/:id` da tela de detalhe.
import { useCallback, useEffect, useState } from 'react';

interface DadosComerciais {
  previsaoFechamento: string | null;
  condicaoEspecial: string | null;
  plano: string | null;
  porteClinica: string | null;
  prontuarioLegado: string | null;
  faturamentoTiss: string | null;
  termoLgpdValidado: boolean;
}

const MENSAGEM_DE_ERRO = 'Não foi possível salvar. Confira os campos e tente de novo.';

function formatarMoeda(valor: string | null): string {
  const numero = valor === null ? NaN : Number(valor);
  return Number.isNaN(numero) ? '—' : numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** `2026-11-25` → `25/11/2026`, sem passar por fuso (a data é só um dia). */
function formatarDia(dia: string | null): string {
  if (!dia) return '—';
  const [ano, mes, d] = dia.split('-');
  return `${d}/${mes}/${ano}`;
}

/** Porcentagem do bloco de qualificação: quantos dos quatro itens estão preenchidos. */
export function percentualQualificado(dados: DadosComerciais): number {
  const itens = [dados.porteClinica, dados.prontuarioLegado, dados.faturamentoTiss].filter((v) => v && v.trim() !== '').length + (dados.termoLgpdValidado ? 1 : 0);
  return Math.round((itens / 4) * 100);
}

const CAMPO =
  'w-full h-9 px-2.5 rounded-lg bg-surface-subtle font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20';

function useDadosComerciais(cardId: string) {
  const [dados, setDados] = useState<DadosComerciais | null>(null);
  const [erroDeLeitura, setErroDeLeitura] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/oportunidades/${cardId}/comercial`)
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`comercial respondeu ${resposta.status}`);
        return resposta.json() as Promise<DadosComerciais>;
      })
      .then((corpo) => {
        if (!cancelado) setDados(corpo);
      })
      .catch(() => {
        if (!cancelado) setErroDeLeitura(true);
      });
    return () => {
      cancelado = true;
    };
  }, [cardId]);

  const salvar = useCallback(
    async (mudancas: Partial<DadosComerciais>): Promise<boolean> => {
      try {
        const resposta = await fetch(`/api/oportunidades/${cardId}/comercial`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mudancas),
        });
        if (!resposta.ok) return false;
        setDados((await resposta.json()) as DadosComerciais);
        return true;
      } catch {
        return false;
      }
    },
    [cardId]
  );

  return { dados, erroDeLeitura, salvar };
}

interface BlocoProps {
  titulo: string;
  icone: string;
  selo?: string;
  editando: boolean;
  salvando: boolean;
  erro: string | null;
  onEditar: () => void;
  onCancelar: () => void;
  onSalvar: () => void;
  children: React.ReactNode;
}

function Bloco({ titulo, icone, selo, editando, salvando, erro, onEditar, onCancelar, onSalvar, children }: BlocoProps) {
  return (
    <section aria-label={titulo} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-[20px]">
            {icone}
          </span>
          {titulo}
        </h3>
        <div className="flex items-center gap-2">
          {selo && <span className="font-label-sm text-label-sm font-bold text-success-text">{selo}</span>}
          {!editando && (
            <button type="button" onClick={onEditar} aria-label={`Editar ${titulo}`} className="h-8 w-8 rounded-lg bg-surface-subtle hover:bg-surface-container flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                edit
              </span>
            </button>
          )}
        </div>
      </div>
      {children}
      {erro && (
        <p role="alert" className="font-body-sm text-body-sm text-danger-text">
          {erro}
        </p>
      )}
      {editando && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} disabled={salvando} className="h-9 px-3 rounded-lg bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary">
            Cancelar
          </button>
          <button type="button" onClick={onSalvar} disabled={salvando} className="h-9 px-3 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold disabled:opacity-60">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 font-body-md text-body-md">
      <span className="text-text-secondary">{rotulo}</span>
      <span className="text-text-primary font-semibold text-right">{children}</span>
    </div>
  );
}

function Entrada({ id, rotulo, ...props }: { id: string; rotulo: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-label-sm text-label-sm text-text-secondary">
        {rotulo}
      </label>
      <input id={id} {...props} className={CAMPO} />
    </div>
  );
}

interface DadosDaPropostaProps {
  cardId: string;
  /** Valor estimado do card (o "MRR ofertado"), como veio da API. */
  valor: string | null;
}

export function DadosDaProposta({ cardId, valor: valorInicial }: DadosDaPropostaProps) {
  const { dados, erroDeLeitura, salvar } = useDadosComerciais(cardId);
  const [valor, setValor] = useState(valorInicial);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ mrr: '', previsao: '', condicao: '', plano: '' });

  useEffect(() => setValor(valorInicial), [valorInicial]);

  if (erroDeLeitura) return null;
  if (!dados) return null;

  function abrir() {
    setRascunho({
      mrr: valor ? String(Number(valor)) : '',
      previsao: dados?.previsaoFechamento ?? '',
      condicao: dados?.condicaoEspecial ?? '',
      plano: dados?.plano ?? '',
    });
    setErro(null);
    setEditando(true);
  }

  async function gravar() {
    setSalvando(true);
    setErro(null);
    try {
      const mrrAntes = valor ? Number(valor) : null;
      const mrrDepois = rascunho.mrr.trim() === '' ? null : Number(rascunho.mrr.replace(',', '.'));
      if (mrrAntes !== mrrDepois) {
        const resposta = await fetch(`/api/oportunidades/${cardId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ valor: mrrDepois }),
        });
        if (!resposta.ok) {
          const corpo = (await resposta.json().catch(() => null)) as { codigo?: string } | null;
          setErro(corpo?.codigo === 'VALOR_OBRIGATORIO_NA_PROPOSTA' ? 'Na etapa Proposta o MRR é obrigatório.' : MENSAGEM_DE_ERRO);
          return;
        }
        setValor(mrrDepois === null ? null : mrrDepois.toFixed(2));
      }
      const ok = await salvar({
        previsaoFechamento: rascunho.previsao === '' ? null : rascunho.previsao,
        condicaoEspecial: rascunho.condicao,
        plano: rascunho.plano,
      });
      if (!ok) {
        setErro(MENSAGEM_DE_ERRO);
        return;
      }
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Bloco titulo="Dados da Proposta" icone="request_quote" editando={editando} salvando={salvando} erro={erro} onEditar={abrir} onCancelar={() => setEditando(false)} onSalvar={() => void gravar()}>
      {editando ? (
        <div className="flex flex-col gap-2">
          <Entrada id="proposta-mrr" rotulo="MRR ofertado (R$/mês)" inputMode="decimal" value={rascunho.mrr} onChange={(e) => setRascunho((r) => ({ ...r, mrr: e.target.value }))} />
          <Entrada id="proposta-previsao" rotulo="Previsão de fechamento" type="date" value={rascunho.previsao} onChange={(e) => setRascunho((r) => ({ ...r, previsao: e.target.value }))} />
          <Entrada id="proposta-condicao" rotulo="Condição especial" maxLength={200} value={rascunho.condicao} onChange={(e) => setRascunho((r) => ({ ...r, condicao: e.target.value }))} />
          <Entrada id="proposta-plano" rotulo="Plano" maxLength={200} value={rascunho.plano} onChange={(e) => setRascunho((r) => ({ ...r, plano: e.target.value }))} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="bg-surface-subtle rounded-lg px-space-md py-space-sm flex items-center justify-between">
            <span className="text-text-secondary font-body-md text-body-md">MRR Ofertado:</span>
            <span className="font-headline-sm text-headline-sm text-text-primary font-bold">
              {formatarMoeda(valor)}
              {valor && <span className="text-text-muted font-normal text-body-sm">/mês</span>}
            </span>
          </div>
          <Linha rotulo="Previsão Fechamento:">{formatarDia(dados.previsaoFechamento)}</Linha>
          <Linha rotulo="Condição Especial:">{dados.condicaoEspecial ?? '—'}</Linha>
          <Linha rotulo="Plano:">{dados.plano ?? '—'}</Linha>
        </div>
      )}
    </Bloco>
  );
}

export function QualificacaoTecnica({ cardId }: { cardId: string }) {
  const { dados, erroDeLeitura, salvar } = useDadosComerciais(cardId);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ porte: '', prontuario: '', tiss: '', lgpd: false });

  if (erroDeLeitura || !dados) return null;

  function abrir() {
    setRascunho({
      porte: dados?.porteClinica ?? '',
      prontuario: dados?.prontuarioLegado ?? '',
      tiss: dados?.faturamentoTiss ?? '',
      lgpd: dados?.termoLgpdValidado ?? false,
    });
    setErro(null);
    setEditando(true);
  }

  async function gravar() {
    setSalvando(true);
    setErro(null);
    try {
      const ok = await salvar({
        porteClinica: rascunho.porte,
        prontuarioLegado: rascunho.prontuario,
        faturamentoTiss: rascunho.tiss,
        termoLgpdValidado: rascunho.lgpd,
      });
      if (!ok) setErro(MENSAGEM_DE_ERRO);
      else setEditando(false);
    } finally {
      setSalvando(false);
    }
  }

  const percentual = percentualQualificado(dados);

  return (
    <Bloco titulo="Qualificação Técnica" icone="fact_check" selo={`${percentual}% OK`} editando={editando} salvando={salvando} erro={erro} onEditar={abrir} onCancelar={() => setEditando(false)} onSalvar={() => void gravar()}>
      {editando ? (
        <div className="flex flex-col gap-2">
          <Entrada id="qualificacao-porte" rotulo="Porte da clínica" maxLength={200} value={rascunho.porte} onChange={(e) => setRascunho((r) => ({ ...r, porte: e.target.value }))} />
          <Entrada id="qualificacao-prontuario" rotulo="Prontuário legado" maxLength={200} value={rascunho.prontuario} onChange={(e) => setRascunho((r) => ({ ...r, prontuario: e.target.value }))} />
          <Entrada id="qualificacao-tiss" rotulo="Faturamento TISS" maxLength={200} value={rascunho.tiss} onChange={(e) => setRascunho((r) => ({ ...r, tiss: e.target.value }))} />
          <label className="flex items-center gap-2 font-body-md text-body-md text-text-primary">
            <input type="checkbox" checked={rascunho.lgpd} onChange={(e) => setRascunho((r) => ({ ...r, lgpd: e.target.checked }))} className="w-4 h-4 rounded text-primary" />
            Termo LGPD validado
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Linha rotulo="Porte da Clínica:">{dados.porteClinica ?? '—'}</Linha>
          <Linha rotulo="Prontuário Legado:">{dados.prontuarioLegado ?? '—'}</Linha>
          <Linha rotulo="Faturamento TISS:">{dados.faturamentoTiss ?? '—'}</Linha>
          <Linha rotulo="Termo LGPD Validado:">
            {dados.termoLgpdValidado ? (
              <span className="inline-flex items-center gap-1 text-success-text">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                  check_circle
                </span>
                Sim
              </span>
            ) : (
              'Não'
            )}
          </Linha>
        </div>
      )}
    </Bloco>
  );
}

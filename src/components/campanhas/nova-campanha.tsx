'use client';

// T-198 (fase4-campanhas, US-130): tela "Nova Campanha de Comunicação Médica" e edição
// de rascunho — fonte visual `docs/ui/stitch_medcrm_interface_design/21._campanhas_nova_criar_e_editar_rascunho/`.
// Cria em rascunho por `POST /api/campanhas` (origem: várias etapas do funil ou lista
// colada) e edita nome, assunto e corpo por `PATCH` (`?rascunho=<id>`). Nada é enviado
// aqui: o Play é do detalhe (ASM-189).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { VariaveisDisponiveis, NOME_DE_EXEMPLO } from '@/components/comum/variaveis-disponiveis';
import { ETAPAS_PIPELINE } from '@/components/pipeline/detalhe/jornada';
import { renderizarCorpoDeCampanha } from '@/lib/email/campanha-corpo';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { mensagemDeErro } from './comum';
import { EsqueletoCarregando, EstadoErro } from './estados';
import { aplicarTrecho, definirPrecabecalho, lerPrecabecalho, MODELO_BASICO, MODELOS, TRECHOS } from './modelos-html';
import { ChecklistDoDisparo } from './checklist-disparo';
import { PreviaEmail, type LarguraDaPrevia } from './previa-email';

interface PreviaView {
  porEtapa: { etapaId: number; total: number }[];
  total: number;
  valorEmPipeline: number;
  descadastrados?: number;
  protegidos?: number;
}

const LIMITE_HTML_BYTES = 1024 * 1024;
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cada linha "nome, e-mail" (ou só o e-mail); e-mails inválidos e repetidos saem (mesma regra do servidor, AC-236). */
export function lerListaColada(texto: string): { nome: string; email: string }[] {
  const vistos = new Set<string>();
  const contatos: { nome: string; email: string }[] = [];
  for (const linha of texto.split('\n')) {
    const partes = linha.split(/[;,\t]/).map((p) => p.trim()).filter(Boolean);
    const email = (partes.find((p) => EMAIL.test(p)) ?? '').toLowerCase();
    if (!email || vistos.has(email)) continue;
    vistos.add(email);
    contatos.push({ nome: partes.find((p) => p.toLowerCase() !== email) ?? email.split('@')[0], email });
  }
  return contatos;
}

export function NovaCampanha() {
  const router = useRouter();
  const parametros = useSearchParams();
  const rascunhoId = parametros.get('rascunho');

  const [nome, setNome] = useState('');
  const [assunto, setAssunto] = useState('');
  const [corpoHtml, setCorpoHtml] = useState('');
  const campoDoCorpo = useRef<HTMLTextAreaElement>(null);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const [remetente, setRemetente] = useState<string | null | undefined>(undefined);
  const [responderPara, setResponderPara] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [modo, setModo] = useState<'etapas' | 'lista'>('etapas');
  const [etapasEscolhidas, setEtapasEscolhidas] = useState<number[]>([]);
  const [lista, setLista] = useState('');
  const [contagens, setContagens] = useState<Record<number, number>>({});
  const [previa, setPrevia] = useState<PreviaView | null>(null);
  const [protegerFrequencia, setProtegerFrequencia] = useState(true);
  const [largura, setLargura] = useState<LarguraDaPrevia>('desktop');
  const [salvando, setSalvando] = useState(false);
  const [faltas, setFaltas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criada, setCriada] = useState<{ destino: string; total: number; invalidos: number; repetidos: number; descadastrados: number; protegidos: number } | null>(null);

  // Edição de rascunho (AC-539/AC-544).
  const [carregandoRascunho, setCarregandoRascunho] = useState(Boolean(rascunhoId));
  const [erroRascunho, setErroRascunho] = useState(false);
  const [totalDoRascunho, setTotalDoRascunho] = useState(0);
  const [bloqueada, setBloqueada] = useState(false);

  const carregarRascunho = useCallback(async () => {
    if (!rascunhoId) return;
    try {
      const r = await fetch(`/api/campanhas/${rascunhoId}`);
      if (!r.ok) throw new Error(`campanha respondeu ${r.status}`);
      const c = (await r.json()) as { campanha: { nome: string; assunto: string; corpoHtml: string; status: string }; destinatarios: unknown[] };
      setNome(c.campanha.nome);
      setAssunto(c.campanha.assunto);
      setCorpoHtml(c.campanha.corpoHtml);
      setTotalDoRascunho(c.destinatarios.length);
      setBloqueada(c.campanha.status !== 'RASCUNHO');
      setErroRascunho(false);
    } catch {
      setErroRascunho(true);
    } finally {
      setCarregandoRascunho(false);
    }
  }, [rascunhoId]);

  useEffect(() => {
    void carregarRascunho();
  }, [carregarRascunho]);

  // AC-542: a contagem de cada etapa (todas de uma vez) e o total das escolhidas.
  const carregarContagens = useCallback(async () => {
    try {
      const r = await fetch(`/api/campanhas/previa-destinatarios?etapaIds=${ETAPAS_PIPELINE.map((e) => e.id).join(',')}`);
      if (!r.ok) return;
      const corpo = (await r.json()) as PreviaView;
      setContagens(Object.fromEntries(corpo.porEtapa.map((e) => [e.etapaId, e.total])));
    } catch {
      // Sem a contagem a tela segue funcionando; o total das escolhidas mostra o que faltou.
    }
  }, []);

  const carregarPrevia = useCallback(async () => {
    if (etapasEscolhidas.length === 0) {
      setPrevia(null);
      return;
    }
    try {
      const r = await fetch(`/api/campanhas/previa-destinatarios?etapaIds=${[...etapasEscolhidas].sort((a, b) => a - b).join(',')}${protegerFrequencia ? '&protegerFrequencia=1' : ''}`);
      if (r.ok) setPrevia((await r.json()) as PreviaView);
    } catch {
      setPrevia(null);
    }
  }, [etapasEscolhidas, protegerFrequencia]);

  useEffect(() => {
    if (rascunhoId) return;
    void carregarContagens();
  }, [rascunhoId, carregarContagens]);

  useEffect(() => {
    if (rascunhoId) return;
    void carregarPrevia();
  }, [rascunhoId, carregarPrevia]);

  const contatosDaLista = useMemo(() => lerListaColada(lista), [lista]);
  useEffect(() => {
    let cancelado = false;
    fetch('/api/configuracoes/email')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { remetente?: string | null; responderPara?: string } | null) => {
        if (cancelado) return;
        setRemetente(c ? (c.remetente ?? null) : null);
        setResponderPara(c?.responderPara ?? null);
      })
      .catch(() => !cancelado && setRemetente(null));
    return () => {
      cancelado = true;
    };
  }, []);

  /** Barra de formatação: o trecho entra no cursor (ou envolve o texto selecionado). */
  function aplicar(trecho: (typeof TRECHOS)[number]) {
    const campo = campoDoCorpo.current;
    const inicio = campo?.selectionStart ?? corpoHtml.length;
    const fim = campo?.selectionEnd ?? inicio;
    const r = aplicarTrecho(corpoHtml, inicio, fim, trecho);
    setCorpoHtml(r.texto);
    setTimeout(() => {
      campo?.focus();
      campo?.setSelectionRange(r.cursor, r.cursor);
    }, 0);
  }

  async function enviarTeste() {
    setResultadoTeste(null);
    if (!assunto.trim() || !corpoHtml.trim()) {
      setResultadoTeste({ ok: false, texto: 'Preencha o assunto e o corpo antes de enviar o teste.' });
      return;
    }
    setTestando(true);
    try {
      const r = await fetch('/api/campanhas/teste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assunto, corpoHtml }) });
      const c = (await r.json().catch(() => null)) as { para?: string; codigo?: string } | null;
      if (r.ok) setResultadoTeste({ ok: true, texto: `Teste enviado para ${c?.para ?? 'o seu e-mail'}. Pode levar alguns minutos para chegar.` });
      else if (c?.codigo === 'CHAVE_RESEND_NAO_CONFIGURADA') setResultadoTeste({ ok: false, texto: 'A chave do Resend ainda não foi configurada. Configure em Configurações > E-mail.' });
      else setResultadoTeste({ ok: false, texto: 'Não foi possível enviar o teste. Confira a chave e o remetente do Resend.' });
    } catch {
      setResultadoTeste({ ok: false, texto: 'Não foi possível enviar o teste. Tente de novo.' });
    } finally {
      setTestando(false);
    }
  }

  /** Lê um .html do computador para dentro do campo (até 1 MB); o conteúdo continua sendo só texto até ser enviado. */
  async function importarHtml(arquivo: File | null, campo: HTMLInputElement) {
    setErroImportacao(null);
    if (!arquivo) return;
    if (arquivo.size > LIMITE_HTML_BYTES) {
      setErroImportacao('O arquivo passa de 1 MB. Reduza o HTML (imagens devem ser links, não embutidas).');
    } else {
      setCorpoHtml(await arquivo.text());
    }
    campo.value = '';
  }

  /** AC-700: coloca o shortcode onde está o cursor do corpo (ou no fim, se o campo nunca foi tocado). */
  function inserirVariavel(variavel: string) {
    const campo = campoDoCorpo.current;
    const inicio = campo?.selectionStart ?? corpoHtml.length;
    const fim = campo?.selectionEnd ?? inicio;
    const codigo = `{{${variavel}}}`;
    setCorpoHtml(corpoHtml.slice(0, inicio) + codigo + corpoHtml.slice(fim));
    const posicao = inicio + codigo.length;
    setTimeout(() => {
      campo?.focus();
      campo?.setSelectionRange(posicao, posicao);
    }, 0);
  }

  const totalDestinatarios = rascunhoId ? totalDoRascunho : modo === 'lista' ? contatosDaLista.length : (previa?.total ?? 0);

  function alternarEtapa(id: number) {
    setEtapasEscolhidas((atual) => (atual.includes(id) ? atual.filter((e) => e !== id) : [...atual, id]));
  }

  async function salvar(destino: 'lista' | 'detalhe') {
    const que: string[] = [];
    if (!nome.trim()) que.push('o nome da campanha');
    if (!assunto.trim()) que.push('o assunto');
    if (!corpoHtml.trim()) que.push('o corpo do e-mail');
    if (!rascunhoId && totalDestinatarios === 0) que.push('pelo menos um destinatário com e-mail válido');
    setFaltas(que);
    setErro(null);
    if (que.length > 0) return;

    setSalvando(true);
    try {
      if (rascunhoId) {
        const r = await fetch(`/api/campanhas/${rascunhoId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nome, assunto, corpoHtml }),
        });
        if (r.ok) {
          router.push(`/campanhas/${rascunhoId}`);
          return;
        }
        const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
        setErro(mensagemDeErro(corpo?.codigo));
        return;
      }

      const origem = modo === 'lista' ? { tipo: 'planilha', contatos: contatosDaLista } : { tipo: 'etapas', etapaIds: etapasEscolhidas };
      const r = await fetch('/api/campanhas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nome, assunto, corpoHtml, origem, protegerFrequencia }),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { codigo?: string; mensagem?: string } | null;
        setErro(corpo?.mensagem ?? mensagemDeErro(corpo?.codigo));
        return;
      }
      const criadaOk = (await r.json()) as { id: string; totalDestinatarios: number; descartadosInvalidos: number; descartadosRepetidos: number; descartadosDescadastrados?: number; descartadosProtegidos?: number };
      const caminho = destino === 'lista' ? '/campanhas' : `/campanhas/${criadaOk.id}`;
      if (criadaOk.descartadosInvalidos + criadaOk.descartadosRepetidos + (criadaOk.descartadosDescadastrados ?? 0) + (criadaOk.descartadosProtegidos ?? 0) > 0) {
        setCriada({ destino: caminho, total: criadaOk.totalDestinatarios, invalidos: criadaOk.descartadosInvalidos, repetidos: criadaOk.descartadosRepetidos, descadastrados: criadaOk.descartadosDescadastrados ?? 0, protegidos: criadaOk.descartadosProtegidos ?? 0 });
      } else {
        router.push(caminho);
      }
    } catch {
      setErro('Não foi possível salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregandoRascunho) return <div className="p-space-md"><EsqueletoCarregando /></div>;
  if (erroRascunho) return <div className="p-space-md"><EstadoErro mensagem="Não foi possível carregar o rascunho. Tente de novo." onTentarDeNovo={carregarRascunho} /></div>;

  const CLASSE_CAMPO = 'h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary w-full focus:outline-none';

  return (
    <div className="p-space-md flex flex-col gap-space-md xl:h-[calc(100dvh-4rem)] xl:min-h-[44rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">{rascunhoId ? 'Editar Campanha' : 'Nova Campanha de Comunicação Médica'}</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1">Monte o e-mail e escolha quem recebe. Nada é enviado até você iniciar o disparo.</p>
        </div>
        <div className="flex items-center gap-space-sm flex-wrap">
          <Link href="/campanhas" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
            Voltar para Campanhas
          </Link>
          <button type="button" onClick={() => void salvar('lista')} disabled={salvando || bloqueada} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50">
            Salvar Rascunho
          </button>
          <button type="button" onClick={() => void salvar('detalhe')} disabled={salvando || bloqueada} className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50">
            Avançar para Envio &amp; Revisão
          </button>
        </div>
      </div>

      {bloqueada && (
        <p role="alert" className="font-body-md text-body-md text-warning-text bg-warning-surface rounded-lg px-3 py-2">
          Esta campanha já foi iniciada e não pode ser editada.
        </p>
      )}
      {faltas.length > 0 && (
        <p role="alert" className="font-body-md text-body-md text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          Falta informar: {faltas.join(', ')}.
        </p>
      )}
      {erro && (
        <p role="alert" className="font-body-md text-body-md text-danger-text bg-danger-surface rounded-lg px-3 py-2">
          {erro}
        </p>
      )}
      {criada && (
        <p role="status" className="font-body-md text-body-md text-success-text bg-success-surface rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
          <span>
            Campanha criada com {criada.total} destinatários. {criada.invalidos} e-mails inválidos e {criada.repetidos} repetidos foram descartados.
            {criada.descadastrados > 0 && ` ${criada.descadastrados} ${criada.descadastrados === 1 ? 'descadastrado ficou' : 'descadastrados ficaram'} de fora.`}
            {criada.protegidos > 0 && ` ${criada.protegidos} ${criada.protegidos === 1 ? 'contato ficou' : 'contatos ficaram'} de fora pela proteção de frequência.`}
          </span>
          <button type="button" onClick={() => router.push(criada.destino)} className="h-9 px-3 rounded-lg bg-surface-card font-label-md text-label-md font-semibold text-text-primary">
            Continuar
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md xl:flex-1 xl:min-h-0">
        <div className="flex flex-col gap-space-md xl:min-h-0 xl:overflow-y-auto">
          <section aria-label="Identificação e Parâmetros de Disparo" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">1. Identificação e Parâmetros de Disparo</h2>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Nome interno da campanha *
              <input value={nome} onChange={(e) => setNome(e.target.value)} disabled={bloqueada} aria-label="Nome interno da campanha" className={CLASSE_CAMPO} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-0.5">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Canal de envio</span>
                <span className="font-body-md text-body-md text-text-primary flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">mail</span>
                  E-mail (Resend)
                </span>
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-0.5">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">Nome e e-mail do remetente</span>
                <span className="font-body-md text-body-md text-text-primary break-all">
                  {remetente === undefined ? '...' : (remetente ?? 'Padrão do sistema')}
                </span>
                <Link href="/configuracoes/email" className="font-body-sm text-body-sm text-primary font-semibold hover:underline w-fit">
                  Alterar em Configurações
                </Link>
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-0.5 sm:col-span-2">
                <span className="font-label-sm text-label-sm text-text-muted uppercase">E-mail de resposta</span>
                <span className="font-body-md text-body-md text-text-primary break-all flex items-center gap-1.5">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-primary">reply</span>
                  {responderPara ?? 'Igual ao remetente'}
                </span>
                <Link href="/configuracoes/email" className="font-body-sm text-body-sm text-primary font-semibold hover:underline w-fit">
                  {responderPara ? 'Alterar em Configurações' : 'Definir em Configurações'}
                </Link>
              </div>
            </div>
          </section>

          <section aria-label="Segmentação de Destinatários" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">2. Segmentação de Destinatários</h2>
              {!rascunhoId && modo === 'etapas' && (
                <button type="button" onClick={() => { void carregarContagens(); void carregarPrevia(); }} className="font-label-md text-label-md text-primary font-semibold">
                  Recalcular
                </button>
              )}
            </div>
            {rascunhoId ? (
              <p className="font-body-md text-body-md text-text-secondary">Destinatários já definidos: {totalDoRascunho}</p>
            ) : (
              <>
                <div role="tablist" aria-label="Origem dos destinatários" className="flex items-center gap-1 rounded-xl bg-surface-subtle p-1 self-start">
                  {(['etapas', 'lista'] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={modo === m} onClick={() => setModo(m)} className={`h-8 px-3 rounded-lg font-label-md text-label-md ${modo === m ? 'bg-surface-card text-primary font-semibold shadow-sm' : 'text-text-secondary'}`}>
                      {m === 'etapas' ? 'Etapas do funil' : 'Lista colada'}
                    </button>
                  ))}
                </div>
                {modo === 'etapas' ? (
                  <div className="flex flex-wrap gap-2">
                    {ETAPAS_PIPELINE.map((e) => (
                      <label key={e.id} className={`h-9 px-3 rounded-lg flex items-center gap-2 font-label-md text-label-md cursor-pointer ${etapasEscolhidas.includes(e.id) ? 'bg-primary text-on-primary' : 'bg-surface-subtle text-text-primary'}`}>
                        <input type="checkbox" checked={etapasEscolhidas.includes(e.id)} onChange={() => alternarEtapa(e.id)} aria-label={e.nome} />
                        {e.nome}
                        <span className="opacity-80">{contagens[e.id] ?? 0}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
                    Contatos (um por linha: nome, e-mail)
                    <textarea value={lista} onChange={(e) => setLista(e.target.value)} rows={6} aria-label="Contatos" className="rounded-xl bg-surface-subtle p-3 font-body-md text-body-md text-text-primary" />
                  </label>
                )}
                <div className="rounded-xl bg-info-surface p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-headline-sm text-headline-sm text-text-primary">
                      <span aria-label="Destinatários qualificados">{totalDestinatarios}</span> Destinatários qualificados
                    </p>
                    <p className="font-body-sm text-body-sm text-text-secondary">E-mails válidos, sem repetir.</p>
                    {!rascunhoId && modo !== 'lista' && protegerFrequencia && (previa?.protegidos ?? 0) > 0 && (
                  <p className="font-body-sm text-body-sm text-warning-text">
                    {previa!.protegidos} {previa!.protegidos === 1 ? 'contato fica' : 'contatos ficam'} de fora pela proteção de frequência.
                  </p>
                )}
                {!rascunhoId && modo !== 'lista' && (previa?.descadastrados ?? 0) > 0 && (
                      <p className="font-body-sm text-body-sm text-warning-text">
                        {previa!.descadastrados} {previa!.descadastrados === 1 ? 'descadastrado fica' : 'descadastrados ficam'} de fora.
                      </p>
                    )}
                  </div>
                </div>
                <label className="flex items-start gap-3 rounded-xl bg-surface-subtle p-3 cursor-pointer">
                  <input type="checkbox" checked={protegerFrequencia} onChange={(e) => setProtegerFrequencia(e.target.checked)} className="mt-1 w-4 h-4" aria-label="Proteção de frequência" />
                  <span className="flex flex-col">
                    <span className="font-label-md text-label-md text-text-primary font-semibold">Proteção de frequência comercial (anti-fadiga)</span>
                    <span className="font-body-sm text-body-sm text-text-secondary">
                      Deixa de fora quem recebeu qualquer e-mail de campanha nas últimas 72 horas, para evitar cancelamentos e desgaste com o contato.
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <ItemEmBreve rotulo="Especialidade médica predominante" icone="stethoscope" className="h-9 px-3 rounded-lg bg-surface-subtle" />
                  <ItemEmBreve rotulo="Porte da clínica" icone="apartment" className="h-9 px-3 rounded-lg bg-surface-subtle" />
                </div>
              </>
            )}
          </section>

          <section aria-label="Composição do E-mail" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">3. Composição do E-mail e Mala Direta</h2>
            <div className="flex flex-wrap gap-2">
              {MODELOS.map((m) => (
                <button key={m.id} type="button" disabled={bloqueada} onClick={() => setCorpoHtml(m.html)} className="h-9 px-3 rounded-lg bg-surface-subtle hover:bg-surface-container font-label-md text-label-md text-text-primary flex items-center gap-1.5 disabled:opacity-50">
                  <span aria-hidden="true" className="material-symbols-outlined text-[16px] text-primary">article</span>
                  Modelo {m.rotulo}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Linha de assunto *
              <input value={assunto} onChange={(e) => setAssunto(e.target.value)} disabled={bloqueada} aria-label="Linha de assunto" className={CLASSE_CAMPO} />
              <span className="self-end font-body-sm text-body-sm text-text-muted">{assunto.length} caracteres</span>
            </label>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Texto de pré-cabeçalho <span className="text-text-muted">(opcional: a frase que aparece ao lado do assunto na caixa de entrada)</span>
              <input
                value={lerPrecabecalho(corpoHtml)}
                onChange={(e) => setCorpoHtml(definirPrecabecalho(corpoHtml, e.target.value))}
                disabled={bloqueada || corpoHtml.trim() === ''}
                maxLength={150}
                aria-label="Texto de pré-cabeçalho"
                placeholder={corpoHtml.trim() === '' ? 'Escreva o corpo do e-mail primeiro' : 'Ex.: Condições especiais só até sexta-feira'}
                className={CLASSE_CAMPO}
              />
            </label>
            <div role="toolbar" aria-label="Barra de formatação" className="flex flex-wrap items-center gap-1">
              {TRECHOS.map((t) => (
                <button key={t.id} type="button" disabled={bloqueada} title={t.rotulo} aria-label={t.rotulo} onClick={() => aplicar(t)} className="w-9 h-9 rounded-lg bg-surface-subtle hover:bg-surface-container text-text-primary flex items-center justify-center disabled:opacity-50">
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">{t.icone}</span>
                </button>
              ))}
              <span aria-hidden="true" className="w-px h-6 bg-surface-container mx-1" />
              {['nome', 'primeiro_nome'].map((v) => (
                <button key={v} type="button" disabled={bloqueada} onClick={() => inserirVariavel(v)} className="h-9 px-2 rounded-lg bg-info-surface text-primary font-mono text-[12px] disabled:opacity-50">
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label htmlFor="corpo-html" className="font-label-md text-label-md text-text-secondary">
                  Corpo do e-mail (código HTML) *
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className={`relative h-8 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center gap-1.5 ${bloqueada ? 'opacity-50' : 'cursor-pointer'}`}>
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">upload_file</span>
                    Importar arquivo .html
                    <input type="file" accept=".html,.htm,text/html" disabled={bloqueada} aria-label="Importar arquivo HTML" className="sr-only" onChange={(e) => void importarHtml(e.target.files?.[0] ?? null, e.target)} />
                  </label>
                  <button type="button" disabled={bloqueada} onClick={() => setCorpoHtml(MODELO_BASICO)} className="h-8 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary flex items-center gap-1.5 disabled:opacity-50">
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">code</span>
                    Inserir modelo básico
                  </button>
                  {corpoHtml !== '' && (
                    <button type="button" disabled={bloqueada} onClick={() => setCorpoHtml('')} className="h-8 px-3 rounded-lg text-text-muted hover:text-text-primary font-label-md text-label-md disabled:opacity-50">
                      Limpar
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="corpo-html"
                ref={campoDoCorpo}
                value={corpoHtml}
                onChange={(e) => setCorpoHtml(e.target.value)}
                disabled={bloqueada}
                rows={16}
                spellCheck={false}
                wrap="off"
                placeholder="Cole ou escreva o HTML do e-mail aqui... (ou use um modelo acima)"
                aria-label="Corpo do e-mail"
                className="rounded-xl bg-surface-subtle p-3 font-mono text-[13px] leading-5 text-text-primary overflow-auto resize-y"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap font-body-sm text-body-sm text-text-muted">
                <span>Cole um e-mail completo (com &lt;style&gt;, tabelas e imagens por URL) ou escreva só o trecho do corpo. A prévia ao lado atualiza enquanto você digita.</span>
                <span>{corpoHtml.length.toLocaleString('pt-BR')} caracteres</span>
              </div>
              {erroImportacao && (
                <p role="alert" className="font-body-sm text-body-sm text-danger-text">
                  {erroImportacao}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => void enviarTeste()} disabled={testando} className="h-9 px-3 rounded-lg bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary flex items-center gap-1.5 disabled:opacity-50">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">send</span>
                {testando ? 'Enviando teste...' : 'Enviar E-mail de Teste para Mim'}
              </button>
              {resultadoTeste && (
                <span role={resultadoTeste.ok ? 'status' : 'alert'} className={`font-body-sm text-body-sm ${resultadoTeste.ok ? 'text-success-text' : 'text-danger-text'}`}>
                  {resultadoTeste.texto}
                </span>
              )}
            </div>
          </section>

          <VariaveisDisponiveis
            observacao="Escreva o shortcode no corpo e ele é trocado pelo nome de cada destinatário no envio. A prévia ao lado já mostra um nome de exemplo. Outras variáveis ficam como estão no e-mail."
            onInserir={bloqueada ? undefined : inserirVariavel}
          />
        </div>

        <div className="flex flex-col gap-space-md xl:min-h-0 xl:overflow-y-auto">
          <section aria-label="Pré-visualização do Cliente" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm xl:flex-1 xl:min-h-[26rem]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Pré-visualização do Cliente</h2>
              <div className="flex items-center gap-1 rounded-lg bg-surface-subtle p-1">
                {(['desktop', 'mobile'] as const).map((l) => (
                  <button key={l} type="button" aria-pressed={largura === l} onClick={() => setLargura(l)} className={`h-7 px-2 rounded font-label-md text-label-md ${largura === l ? 'bg-surface-card text-primary font-semibold' : 'text-text-secondary'}`}>
                    {l === 'desktop' ? 'Desktop' : 'Mobile'}
                  </button>
                ))}
              </div>
            </div>
            <PreviaEmail assunto={assunto} corpoHtml={renderizarCorpoDeCampanha(corpoHtml, NOME_DE_EXEMPLO)} largura={largura} preencher />
          </section>

          <ChecklistDoDisparo assunto={assunto} corpoHtml={corpoHtml} />

          <section aria-label="Estimativa de Impacto Comercial" className="bg-surface-card rounded-2xl p-space-md shadow-sm grid grid-cols-2 gap-space-sm shrink-0">
            <div>
              <span className="font-label-sm text-label-sm text-text-muted uppercase">Volume de decisores</span>
              <p className="font-headline-md text-headline-md text-text-primary">{totalDestinatarios}</p>
            </div>
            <div>
              <span className="font-label-sm text-label-sm text-text-muted uppercase">Pipeline impactado</span>
              <p className="font-headline-md text-headline-md text-text-primary">{!rascunhoId && modo === 'etapas' && previa ? MOEDA.format(previa.valorEmPipeline) : '—'}</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

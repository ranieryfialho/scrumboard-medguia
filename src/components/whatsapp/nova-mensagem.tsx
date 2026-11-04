'use client';

// T-191 (fase4-whatsapp, US-125): tela "Nova Mensagem Avulsa (Número Externo)" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/17._whatsapp_nova_mensagem_para_n_mero_avulso/`.
// Envia por `POST /api/whatsapp/send` com `numero` (que o servidor já aceita);
// os modelos são as mensagens automáticas da empresa (`GET /api/whatsapp/config`,
// ASM-178) e os últimos disparos vêm de `GET /api/whatsapp/conversas?filtro=avulsas`.
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PromoverLead } from './promover-lead';
import { LIMITE_MIDIA_BYTES } from '@/domain/whatsapp/midia';
import { normalizarNumero } from '@/domain/whatsapp/numero';
import { formatarNumero, horarioCurto, mensagemDeErroDoEnvio, MENSAGEM_ERRO_PADRAO_DO_ENVIO, type ConversaView } from './comum';

const MENSAGEM_MAX = 4096;
const LEGENDA_MAX = 1024;
const CATEGORIAS = ['Alinhamento médico / Parceria clínica', 'Apresentação institucional', 'Confirmação telefônica', 'Integração técnica', 'Contato administrativo', 'Outro'];

const MODELOS: { chave: string; rotulo: string }[] = [
  { chave: 'evolution_auto_msg_em_contato', rotulo: 'Em contato' },
  { chave: 'evolution_auto_msg_recontato', rotulo: 'Recontato' },
  { chave: 'evolution_auto_msg_reuniao_agendada', rotulo: 'Reunião agendada' },
  { chave: 'evolution_auto_msg_aguardando_ativacao', rotulo: 'Aguardando ativação' },
  { chave: 'evolution_auto_msg_logins_ativados', rotulo: 'Logins ativados' },
];

export function NovaMensagem() {
  const [numero, setNumero] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [criarLead, setCriarLead] = useState(true);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; configurar: boolean } | null>(null);
  const [enviadaPara, setEnviadaPara] = useState<string | null>(null);
  const [modelos, setModelos] = useState<{ chave: string; rotulo: string; texto: string }[] | null>(null);
  const [instancia, setInstancia] = useState<string | null>(null);
  const [disparos, setDisparos] = useState<ConversaView[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/whatsapp/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { config?: Record<string, string> } | null) => {
        if (cancelado) return;
        const config = c?.config ?? {};
        setModelos(MODELOS.filter((m) => (config[m.chave] ?? '').trim() !== '').map((m) => ({ ...m, texto: config[m.chave] })));
      })
      .catch(() => !cancelado && setModelos([]));
    fetch('/api/whatsapp/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { instance?: string | null } | null) => !cancelado && setInstancia(s?.instance ?? null))
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  // T-303: o rascunho da pessoa volta preenchido.
  useEffect(() => {
    let cancelado = false;
    fetch('/api/whatsapp/rascunho')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { rascunho: { numero: string; nome: string; categoria: string; mensagem: string; criarLeadAoResponder: boolean } | null } | null) => {
        if (cancelado || !c?.rascunho) return;
        setNumero(c.rascunho.numero);
        setNome(c.rascunho.nome);
        setCategoria(c.rascunho.categoria);
        setMensagem(c.rascunho.mensagem);
        setCriarLead(c.rascunho.criarLeadAoResponder);
        setAviso('Rascunho recuperado.');
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  async function salvarRascunho() {
    setAviso(null);
    try {
      const r = await fetch('/api/whatsapp/rascunho', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero, nome, categoria, mensagem, criarLeadAoResponder: criarLead }),
      });
      setAviso(r.ok ? 'Rascunho salvo.' : 'Não foi possível salvar o rascunho.');
    } catch {
      setAviso('Não foi possível salvar o rascunho.');
    }
  }

  function reenviar(d: ConversaView) {
    setNumero(formatarNumero(d.numero));
    setNome(d.nome ?? '');
    setCategoria(d.categoria ?? '');
    if (d.ultimaDirecao === 'enviada') setMensagem(d.ultimaMensagem);
    setEnviadaPara(null);
    setErro(null);
    setAviso('Dados carregados do disparo anterior. Confira e envie.');
  }

  const carregarDisparos = () =>
    fetch('/api/whatsapp/conversas?filtro=avulsas&limite=4')
      .then((r) => (r.ok ? r.json() : { conversas: [] }))
      .then((c: { conversas: ConversaView[] }) => setDisparos(c.conversas))
      .catch(() => setDisparos([]));

  useEffect(() => {
    void carregarDisparos();
  }, []);

  const normalizado = numero.trim() === '' ? null : normalizarNumero(numero);
  const numeroInvalido = numero.trim() !== '' && !normalizado;
  const arquivoGrande = arquivo !== null && arquivo.size > LIMITE_MIDIA_BYTES;
  const podeEnviar = !!normalizado && mensagem.trim() !== '' && mensagem.length <= MENSAGEM_MAX && !enviando && !arquivoGrande;

  async function enviar() {
    if (!normalizado || !podeEnviar) return;
    setEnviando(true);
    setErro(null);
    setEnviadaPara(null);
    try {
      const extras = { destinatarioNome: nome.trim(), categoria, criarLeadAoResponder: criarLead };
      const texto = mensagem.trim();
      // Com anexo, o texto vai de legenda; passando de 1024 caracteres, o texto vai antes, em mensagem própria.
      const textoAntes = arquivo === null || texto.length > LEGENDA_MAX;
      let r: Response | null = null;
      if (textoAntes) {
        r = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ numero: normalizado, mensagem: texto, ...extras }),
        });
      }
      if (arquivo && (r === null || r.ok)) {
        const f = new FormData();
        f.set('arquivo', arquivo);
        f.set('modo', 'arquivo');
        f.set('numero', normalizado);
        if (!textoAntes) f.set('legenda', texto);
        f.set('destinatarioNome', extras.destinatarioNome);
        f.set('categoria', extras.categoria);
        f.set('criarLeadAoResponder', String(extras.criarLeadAoResponder));
        r = await fetch('/api/whatsapp/send-midia', { method: 'POST', body: f });
      }
      if (r?.ok) {
        setEnviadaPara(normalizado);
        setNumero('');
        setMensagem('');
        setNome('');
        setCategoria('');
        setArquivo(null);
        setAviso(null);
        void fetch('/api/whatsapp/rascunho', { method: 'DELETE' }).catch(() => undefined);
        void carregarDisparos();
        return;
      }
      if (!r) return;
      const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
      setErro({
        texto: corpo?.codigo === 'ARQUIVO_GRANDE' ? 'O arquivo passa do limite de 16 MB.' : corpo?.codigo === 'TIPO_NAO_PERMITIDO' ? 'Esse tipo de arquivo não pode ser enviado.' : mensagemDeErroDoEnvio(corpo?.codigo),
        configurar: corpo?.codigo === 'WHATSAPP_NAO_CONFIGURADO',
      });
    } catch {
      setErro({ texto: MENSAGEM_ERRO_PADRAO_DO_ENVIO, configurar: false });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="p-space-md flex flex-col gap-space-md xl:h-[calc(100dvh-4rem)] xl:min-h-[40rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div className="flex items-center gap-space-md flex-wrap">
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Nova Mensagem Avulsa (Número Externo)</h1>
          <span className="px-3 py-1 rounded-full bg-info-surface text-primary font-label-md text-label-md flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">forum</span>
            Comunicação Externa Direta
          </span>
        </div>
        <Link href="/whatsapp" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
          Voltar para Caixa de Entrada
        </Link>
      </div>

      <section aria-label="Aviso de governança" className="bg-info-surface rounded-2xl p-space-md flex items-start gap-space-md shrink-0">
        <span aria-hidden="true" className="w-11 h-11 rounded-xl bg-primary text-on-primary flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[24px]">verified_user</span>
        </span>
        <div className="flex flex-col gap-1">
        <h2 className="font-headline-sm text-headline-sm text-text-primary">Aviso importante de governança comercial</h2>
        <p className="font-body-md text-body-md text-text-secondary">
          Esta conversa será enviada para um número de telefone que <strong>não está vinculado a nenhum lead</strong> do CRM. Mensagens avulsas{' '}
          <strong>não geram card no pipeline</strong>, não disparam a régua de 18 toques e não contam nos indicadores de conversão.
        </p>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md xl:flex-1 xl:min-h-0">
        <section aria-label="Parâmetros do Envio" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md xl:min-h-0 xl:overflow-y-auto">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">Parâmetros do Envio</h2>

          <div className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-text-secondary">Instância de envio do WhatsApp</span>
            <p className="h-10 px-3 rounded-xl bg-surface-subtle flex items-center font-body-md text-body-md text-text-primary">
              {instancia ?? 'Instância da empresa'}
            </p>
          </div>

          <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between font-label-md text-label-md text-text-secondary">
              Número de telefone destinatário *
              {normalizado && <span className="text-success-text">Formato WhatsApp válido</span>}
              {numeroInvalido && <span className="text-danger-text">Número inválido</span>}
            </span>
            <input
              type="tel"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="(11) 98721-4490"
              aria-label="Número de telefone destinatário"
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-text-secondary">
              Nome do destinatário ou clínica <span className="text-text-muted">(opcional, para identificação)</span>
            </span>
            <input
              type="text"
              value={nome}
              maxLength={120}
              onChange={(e) => setNome(e.target.value)}
              aria-label="Nome do destinatário"
              placeholder="Dr. Henrique Vilela - Centro Cirúrgico Paulista"
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-text-secondary">Motivo / Categoria da abordagem</span>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              aria-label="Motivo ou categoria"
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary focus:outline-none"
            >
              <option value="">Selecione...</option>
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2">
            <span className="font-label-md text-label-md text-text-secondary">Modelos de mensagem</span>
            {modelos !== null && modelos.length === 0 ? (
              <p className="font-body-sm text-body-sm text-text-muted">
                Nenhum modelo configurado.{' '}
                <Link href="/whatsapp/configuracao" className="text-primary font-semibold hover:underline">
                  Configurar o WhatsApp
                </Link>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {(modelos ?? []).map((m) => (
                  <button key={m.chave} type="button" onClick={() => setMensagem(m.texto)} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md text-text-primary hover:bg-surface-container">
                    {m.rotulo}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-text-secondary">Mensagem inicial *</span>
            <textarea
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={7}
              aria-label="Mensagem inicial"
              className="rounded-xl bg-surface-subtle p-3 font-body-md text-body-md text-text-primary focus:outline-none"
            />
            <span className={`self-end font-body-sm text-body-sm ${mensagem.length > MENSAGEM_MAX ? 'text-danger-text' : 'text-text-muted'}`}>
              {mensagem.length} caracteres
            </span>
          </label>

          <div className="flex flex-col gap-1">
            <span className="font-label-md text-label-md text-text-secondary">Anexo complementar (opcional)</span>
            <label className="relative flex items-center gap-3 rounded-xl bg-surface-subtle px-3 py-2 cursor-pointer">
              <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-primary">attach_file</span>
              <span className="flex-1 min-w-0 font-body-md text-body-md text-text-primary truncate">{arquivo ? arquivo.name : 'PDF, imagem, vídeo ou documento (até 16 MB)'}</span>
              <span className="h-9 px-3 rounded-lg bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center">{arquivo ? 'Trocar' : 'Selecionar arquivo'}</span>
              <input type="file" aria-label="Anexo complementar" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
            {arquivo && (
              <button type="button" onClick={() => setArquivo(null)} className="self-start font-body-sm text-body-sm text-primary font-semibold hover:underline">
                Remover anexo
              </button>
            )}
            {arquivoGrande && <span className="font-body-sm text-body-sm text-danger-text">O arquivo passa do limite de 16 MB.</span>}
          </div>

          <label className="flex items-start gap-3 rounded-xl bg-surface-subtle p-3 cursor-pointer">
            <input type="checkbox" checked={criarLead} onChange={(e) => setCriarLead(e.target.checked)} className="mt-1 w-4 h-4" />
            <span className="flex flex-col">
              <span className="font-label-md text-label-md text-text-primary font-semibold">
                Criar lead no pipeline se houver resposta{' '}
                <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">Recomendado</span>
              </span>
              <span className="font-body-sm text-body-sm text-text-secondary">Se o contato responder, a conversa vira um card em &quot;Entrada de leads&quot;, com o histórico preenchido.</span>
            </span>
          </label>

          {erro && (
            <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
              {erro.texto}{' '}
              {erro.configurar && (
                <Link href="/whatsapp/configuracao" className="font-semibold underline">
                  Configurar o WhatsApp
                </Link>
              )}
            </p>
          )}
          {aviso && (
            <p role="status" className="font-body-sm text-body-sm text-text-secondary">
              {aviso}
            </p>
          )}
          {enviadaPara && (
            <p role="status" className="font-body-md text-body-md text-success-text bg-success-surface rounded-lg px-3 py-2">
              Mensagem enviada.{' '}
              <Link href={`/whatsapp?numero=${enviadaPara}`} className="font-semibold underline">
                Abrir conversa
              </Link>
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void salvarRascunho()}
              className="h-11 px-4 rounded-xl bg-surface-subtle font-label-lg text-label-lg font-semibold text-text-primary flex items-center gap-2"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">bookmark</span>
              Salvar como Rascunho
            </button>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={!podeEnviar}
              className="h-11 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-md disabled:opacity-50"
            >
              Enviar Mensagem pelo WhatsApp
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-space-md xl:min-h-0">
          <section aria-label="Pré-visualização no Destinatário" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2 xl:max-h-[55%] xl:min-h-0 shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Pré-visualização no Destinatário</h2>
              <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">WhatsApp Live</span>
            </div>
            <div className="rounded-2xl bg-[#e7ded3] p-3 min-h-24 overflow-y-auto">
              {mensagem.trim() === '' ? (
                <p className="font-body-sm text-body-sm text-text-muted">A mensagem digitada aparece aqui.</p>
              ) : (
                <p className="max-w-[85%] ml-auto rounded-xl rounded-tr-none bg-[#d9fdd3] text-text-primary px-3 py-2 font-body-md text-body-md whitespace-pre-wrap break-words shadow-sm">{mensagem}</p>
              )}
            </div>
          </section>

          <section aria-label="Últimos Disparos Avulsos" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2 xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Últimos Disparos Avulsos</h2>
              {disparos !== null && <span className="font-body-sm text-body-sm text-text-muted">{disparos.length} registros</span>}
            </div>
            {disparos !== null && disparos.length === 0 && <p className="font-body-sm text-body-sm text-text-muted">Nenhum disparo avulso ainda</p>}
            {(disparos ?? []).map((d) => (
              <article key={d.chave} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-label-lg text-label-lg text-text-primary truncate">{d.nome ?? formatarNumero(d.numero)}</span>
                  <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm ${d.respondida ? 'bg-success-surface text-success-text' : 'bg-warning-surface text-warning-text'}`}>
                    {d.respondida ? 'Respondido' : 'Aguardando'}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-text-muted">
                  {d.nome ? `${formatarNumero(d.numero)}` : ""}
                  {d.categoria ? `${d.nome ? " · " : ""}${d.categoria}` : ""}
                </p>
                <p className="font-body-sm text-body-sm text-text-secondary truncate">{d.ultimaMensagem}</p>
                <div className="flex items-center justify-between">
                  <span className="font-body-sm text-body-sm text-text-muted">{horarioCurto(d.ultimaEm)}</span>
                  <span className="flex items-center gap-3">
                    <button type="button" onClick={() => reenviar(d)} className="font-label-md text-label-md text-primary font-semibold hover:underline flex items-center gap-1">
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">replay</span>
                      Reenviar
                    </button>
                    <Link href={`/whatsapp?numero=${d.numero}`} className="font-label-md text-label-md text-primary font-semibold hover:underline">
                      Abrir Chat
                    </Link>
                  </span>
                </div>
                <PromoverLead numero={d.numero} />
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

'use client';

// T-191 (fase4-whatsapp, US-125): tela "Nova Mensagem Avulsa (Número Externo)" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/17._whatsapp_nova_mensagem_para_n_mero_avulso/`.
// Envia por `POST /api/whatsapp/send` com `numero` (que o servidor já aceita);
// os modelos são as mensagens automáticas da empresa (`GET /api/whatsapp/config`,
// ASM-178) e os últimos disparos vêm de `GET /api/whatsapp/conversas?filtro=avulsas`.
import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PromoverLead } from './promover-lead';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { normalizarNumero } from '@/domain/whatsapp/numero';
import { formatarNumero, horarioCurto, mensagemDeErroDoEnvio, MENSAGEM_ERRO_PADRAO_DO_ENVIO, type ConversaView } from './comum';

const MENSAGEM_MAX = 4096;

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
  const podeEnviar = !!normalizado && mensagem.trim() !== '' && mensagem.length <= MENSAGEM_MAX && !enviando;

  async function enviar() {
    if (!normalizado || !podeEnviar) return;
    setEnviando(true);
    setErro(null);
    setEnviadaPara(null);
    try {
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: normalizado, mensagem: mensagem.trim() }),
      });
      if (r.ok) {
        setEnviadaPara(normalizado);
        setNumero('');
        setMensagem('');
        void carregarDisparos();
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
      setErro({ texto: mensagemDeErroDoEnvio(corpo?.codigo), configurar: corpo?.codigo === 'WHATSAPP_NAO_CONFIGURADO' });
    } catch {
      setErro({ texto: MENSAGEM_ERRO_PADRAO_DO_ENVIO, configurar: false });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Nova Mensagem Avulsa (Número Externo)</h1>
        <Link href="/whatsapp" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_back</span>
          Voltar para Caixa de Entrada
        </Link>
      </div>

      <section aria-label="Aviso de governança" className="bg-info-surface rounded-2xl p-space-md flex flex-col gap-1">
        <h2 className="font-headline-sm text-headline-sm text-text-primary">Aviso importante de governança comercial</h2>
        <p className="font-body-md text-body-md text-text-secondary">
          Esta conversa será enviada para um número de telefone que <strong>não está vinculado a nenhum lead</strong> do CRM. Mensagens avulsas{' '}
          <strong>não geram card no pipeline</strong>, não disparam a régua de 18 toques e não contam nos indicadores de conversão.
        </p>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md items-start">
        <section aria-label="Parâmetros do Envio" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
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

          <div className="flex flex-wrap gap-2">
            <ItemEmBreve rotulo="Nome do destinatário" icone="apartment" className="h-9 px-3 rounded-lg bg-surface-subtle" />
            <ItemEmBreve rotulo="Motivo / Categoria" icone="category" className="h-9 px-3 rounded-lg bg-surface-subtle" />
            <ItemEmBreve rotulo="Anexo complementar" icone="attach_file" className="h-9 px-3 rounded-lg bg-surface-subtle" />
            <ItemEmBreve rotulo="Criar lead se houver resposta" icone="person_add" className="h-9 px-3 rounded-lg bg-surface-subtle" />
          </div>

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
          {enviadaPara && (
            <p role="status" className="font-body-md text-body-md text-success-text bg-success-surface rounded-lg px-3 py-2">
              Mensagem enviada.{' '}
              <Link href={`/whatsapp?numero=${enviadaPara}`} className="font-semibold underline">
                Abrir conversa
              </Link>
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <ItemEmBreve rotulo="Salvar como Rascunho" icone="bookmark" className="h-11 px-4 rounded-xl bg-surface-subtle" />
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

        <div className="flex flex-col gap-space-md">
          <section aria-label="Pré-visualização no Destinatário" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Pré-visualização no Destinatário</h2>
            <div className="rounded-2xl bg-surface-subtle p-3 min-h-32">
              {mensagem.trim() === '' ? (
                <p className="font-body-sm text-body-sm text-text-muted">A mensagem digitada aparece aqui.</p>
              ) : (
                <p className="max-w-[85%] rounded-xl bg-success-surface text-text-primary px-3 py-2 font-body-md text-body-md whitespace-pre-wrap break-words">{mensagem}</p>
              )}
            </div>
          </section>

          <section aria-label="Últimos Disparos Avulsos" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Últimos Disparos Avulsos</h2>
            {disparos !== null && disparos.length === 0 && <p className="font-body-sm text-body-sm text-text-muted">Nenhum disparo avulso ainda</p>}
            {(disparos ?? []).map((d) => (
              <article key={d.chave} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-label-lg text-label-lg text-text-primary">{formatarNumero(d.numero)}</span>
                  <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm ${d.respondida ? 'bg-success-surface text-success-text' : 'bg-warning-surface text-warning-text'}`}>
                    {d.respondida ? 'Respondido' : 'Aguardando'}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-text-secondary truncate">{d.ultimaMensagem}</p>
                <div className="flex items-center justify-between">
                  <span className="font-body-sm text-body-sm text-text-muted">{horarioCurto(d.ultimaEm)}</span>
                  <Link href={`/whatsapp?numero=${d.numero}`} className="font-label-md text-label-md text-primary font-semibold hover:underline">
                    Abrir Chat
                  </Link>
                </div>
                <PromoverLead numero={d.numero} />
              </article>
            ))}
            <ItemEmBreve rotulo="Reenviar" icone="replay" className="font-body-sm" />
          </section>
        </div>
      </div>
    </div>
  );
}

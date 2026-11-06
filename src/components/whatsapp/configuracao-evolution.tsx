'use client';

// T-194 (fase4-whatsapp, US-127): tela "Configurações Técnicas da Evolution API" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/19._whatsapp_configuracao_configura_o_da_inst_ncia/`.
// Só o que existe: o nome da instância é gravado por `POST /api/whatsapp/config`;
// a URL e a chave do servidor, a URL do webhook (segredo mascarado) e os eventos
// vêm de `GET /api/whatsapp/config` (T-193) somente leitura. Diretrizes anti-ban,
// teste de webhook e restaurar padrões não têm backend: "em breve".
import { useCallback, useEffect, useState } from 'react';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { INTERVALO_MAXIMO_SEGUNDOS, INTERVALO_MINIMO_SEGUNDOS, LIMITE_POR_DISPARO } from '@/lib/whatsapp/lote-regras';
import { EsqueletoCarregando, EstadoErro } from './estados';

interface ConfigView {
  empresaId: string;
  config: Record<string, string>;
  servidor: { urlBase: string | null; chaveConfigurada: boolean };
  webhookUrl: string;
  eventos: string[];
}

const REGEX_INSTANCIA = /^[A-Za-z0-9_-]{1,64}$/;
const ROTULO_DO_EVENTO: Record<string, string> = { MESSAGES_UPSERT: 'Essencial', MESSAGES_UPDATE: 'Checks' };
const DESCRICAO_DO_EVENTO: Record<string, string> = {
  MESSAGES_UPSERT: 'Recebimento de novas mensagens em tempo real (texto, áudio, mídia e geolocalização).',
  MESSAGES_UPDATE: 'Status das mensagens enviadas: enviada (✓), entregue (✓✓) e lida (✓✓ azul).',
};

const ERROS_DO_SALVAR: Record<string, string> = {
  INSTANCIA_EM_USO: 'Esse nome de instância já está em uso.',
  SEM_PERMISSAO: 'Só MASTER e GERENTE alteram a configuração.',
  REQUISICAO_INVALIDA: 'Use de 1 a 64 letras, números, - ou _ no nome da instância.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

export function ConfiguracaoEvolution() {
  const [dados, setDados] = useState<ConfigView | null>(null);
  const [erro, setErro] = useState(false);
  const [instancia, setInstancia] = useState('');
  const [podeAlterar, setPodeAlterar] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [verificacao, setVerificacao] = useState<{ ok: boolean; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [testando, setTestando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/whatsapp/config');
      if (!r.ok) throw new Error(`config respondeu ${r.status}`);
      const corpo = (await r.json()) as ConfigView;
      setDados(corpo);
      setInstancia(corpo.config.evolution_instance_name ?? '');
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
    let cancelado = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (!cancelado && u) setPodeAlterar(u.isSuperAdmin === true || u.papel === 'MASTER' || u.papel === 'GERENTE');
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [carregar]);

  const nomeValido = REGEX_INSTANCIA.test(instancia);

  async function salvar() {
    setResultado(null);
    if (!nomeValido) {
      setResultado({ ok: false, texto: ERROS_DO_SALVAR.REQUISICAO_INVALIDA });
      return;
    }
    setSalvando(true);
    try {
      const r = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evolution_instance_name: instancia }),
      });
      if (r.ok) {
        setResultado({ ok: true, texto: 'Configuração salva.' });
        await carregar();
        return;
      }
      const corpo = (await r.json().catch(() => null)) as { codigo?: string } | null;
      setResultado({ ok: false, texto: ERROS_DO_SALVAR[corpo?.codigo ?? ''] ?? 'Não foi possível salvar. Tente de novo.' });
    } catch {
      setResultado({ ok: false, texto: 'Não foi possível salvar. Tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  async function verificarConexao() {
    setVerificacao(null);
    const inicio = performance.now();
    try {
      const r = await fetch('/api/whatsapp/status');
      if (!r.ok) throw new Error(`status respondeu ${r.status}`);
      const s = (await r.json()) as { state: string };
      const ms = Math.max(1, Math.round(performance.now() - inicio));
      const estado = s.state === 'open' ? 'instância conectada' : s.state === 'not_configured' ? 'instância não configurada' : 'instância desconectada';
      setVerificacao({ ok: true, texto: `HTTP 200 OK · ${ms}ms (${estado})` });
    } catch {
      setVerificacao({ ok: false, texto: 'Não foi possível verificar a conexão.' });
    }
  }

  async function copiar() {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.webhookUrl);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  async function testarWebhook() {
    setTestando(true);
    setTeste(null);
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    try {
      const r = await fetch('/api/whatsapp/config/testar-webhook', { method: 'POST' });
      if (r.status === 403) {
        setTeste({ ok: false, texto: 'Só MASTER e GERENTE testam o webhook.' });
        return;
      }
      const c = (await r.json().catch(() => null)) as { ok?: boolean; status?: number; ms?: number } | null;
      setTeste(
        c?.ok
          ? { ok: true, texto: `Teste às ${hora}: o CRM recebeu o evento (HTTP ${c.status}) em ${c.ms}ms.` }
          : { ok: false, texto: `Teste às ${hora}: o webhook não respondeu como esperado${c?.status ? ` (HTTP ${c.status})` : ''}. Confira a URL pública e o segredo.` }
      );
    } catch {
      setTeste({ ok: false, texto: `Teste às ${hora}: não foi possível falar com o servidor.` });
    } finally {
      setTestando(false);
    }
  }

  const bloco = 'bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md';
  const icone = (nome: string) => (
    <span aria-hidden="true" className="w-11 h-11 rounded-xl bg-info-surface text-primary flex items-center justify-center shrink-0">
      <span className="material-symbols-outlined text-[24px]">{nome}</span>
    </span>
  );

  return (
    <div className="p-space-md flex flex-col gap-space-md xl:h-[calc(100dvh-4rem)] xl:min-h-[40rem]">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Configurações Técnicas da Evolution API</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-2xl">Parâmetros do servidor de mensagens, chave de autenticação, webhook e regras de proteção contra banimento.</p>
        </div>
        <div className="flex items-center gap-space-sm">
          <button
            type="button"
            onClick={() => void testarWebhook()}
            disabled={!podeAlterar || testando || !dados}
            className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">rss_feed</span>
            {testando ? 'Testando...' : 'Testar Disparo de Webhook'}
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!podeAlterar || salvando || !dados}
            className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50 flex items-center gap-2"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">save</span>
            Salvar Alterações
          </button>
        </div>
      </div>

      {resultado && (
        <p role={resultado.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 shrink-0 ${resultado.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {resultado.texto}
        </p>
      )}
      {erro && <EstadoErro mensagem="Não foi possível carregar a configuração. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}

      {dados && (
        <div className="flex flex-col gap-space-md xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
          <section aria-label="Ambiente" className="bg-info-surface rounded-2xl p-space-md flex items-center gap-space-md shrink-0">
            {icone('verified_user')}
            <div className="flex-1">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Configuração do WhatsApp da empresa</h2>
              <p className="font-body-md text-body-md text-text-secondary">As definições daqui valem para todo o atendimento pelo Inbox, as cadências e os disparos em lote desta empresa.</p>
            </div>
            {!podeAlterar && <span className="px-3 py-1 rounded-full bg-warning-surface text-warning-text font-label-md text-label-md">Somente leitura</span>}
          </section>

          <section aria-label="Conexão com o Servidor Evolution API" className={bloco}>
            <div className="flex items-center gap-3">
              {icone('dns')}
              <div className="flex-1">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">1. Conexão com o Servidor Evolution API</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Endereço do servidor, chave e instância usada pela empresa</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-text-secondary">URL base do servidor Evolution API</span>
                <p className="h-10 px-3 rounded-xl bg-surface-subtle flex items-center font-body-md text-body-md text-text-primary break-all">{dados.servidor.urlBase ?? 'Não configurada no servidor'}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-center justify-between font-label-md text-label-md text-text-secondary">
                  Global API Token
                  <ItemEmBreve rotulo="Regenerar Chave" />
                </span>
                <p className="h-10 px-3 rounded-xl bg-surface-subtle flex items-center font-body-md text-body-md text-text-primary">
                  {dados.servidor.chaveConfigurada ? '••••••••••••••••  Configurada no servidor' : 'Não configurada no servidor'}
                </p>
              </div>
              <label className="flex flex-col gap-1">
                <span className="font-label-md text-label-md text-text-secondary">Nome da instância ativa (slug) *</span>
                <input
                  value={instancia}
                  onChange={(e) => setInstancia(e.target.value)}
                  disabled={!podeAlterar}
                  aria-label="Nome da instância ativa"
                  className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary focus:outline-none disabled:opacity-60"
                />
                {!podeAlterar && <span className="font-body-sm text-body-sm text-text-muted">Só MASTER e GERENTE alteram.</span>}
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-surface-subtle p-3">
              <span className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => void verificarConexao()} className="h-9 px-3 rounded-lg bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary">
                  Verificar Conexão com o Servidor
                </button>
                <span className="font-body-sm text-body-sm text-text-muted">Checagem de resposta e latência</span>
              </span>
              {verificacao && (
                <span role="status" className={`px-3 py-1 rounded-full font-label-md text-label-md ${verificacao.ok ? 'bg-success-surface text-success-text' : 'bg-danger-surface text-danger-text'}`}>
                  {verificacao.texto}
                </span>
              )}
            </div>
          </section>

          <section aria-label="Configuração de Webhooks & Eventos" className={bloco}>
            <div className="flex items-center gap-3">
              {icone('webhook')}
              <div className="flex-1">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">2. Configuração de Webhooks &amp; Eventos</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Sincronização em tempo real entre o WhatsApp e o MedCRM</p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label-md text-label-md text-text-secondary">URL do webhook do MedCRM</span>
              <div className="flex items-center gap-2">
                <p className="flex-1 min-h-10 px-3 py-2 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary break-all">{dados.webhookUrl}</p>
                <button type="button" onClick={() => void copiar()} className="h-10 px-3 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <span className="font-body-sm text-body-sm text-text-muted">O segredo da URL fica guardado no servidor e nunca é exibido.</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-label-md text-label-md text-text-secondary">Eventos assinados para despacho</span>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {dados.eventos.map((evento) => (
                  <li key={evento} className="rounded-xl bg-surface-subtle p-3 flex items-start gap-3">
                    <input type="checkbox" checked readOnly disabled aria-label={`${evento} assinado`} className="mt-1 w-4 h-4" />
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-2 font-label-lg text-label-lg text-text-primary">
                        {evento}
                        {ROTULO_DO_EVENTO[evento] && <span className="px-2 py-0.5 rounded-full bg-info-surface text-info-text font-label-sm text-label-sm">{ROTULO_DO_EVENTO[evento]}</span>}
                      </span>
                      {DESCRICAO_DO_EVENTO[evento] && <span className="font-body-sm text-body-sm text-text-secondary">{DESCRICAO_DO_EVENTO[evento]}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-surface-subtle p-3">
              <span className="flex items-center gap-3 min-w-0">
                <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${teste ? (teste.ok ? 'bg-success-text' : 'bg-danger-text') : 'bg-text-muted'}`} />
                <span className="flex flex-col min-w-0">
                  <span className="font-label-md text-label-md text-text-primary font-semibold">Log do último teste de webhook</span>
                  <span role="status" className="font-body-sm text-body-sm text-text-secondary">{teste ? teste.texto : 'Nenhum teste feito nesta sessão.'}</span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => void testarWebhook()}
                disabled={!podeAlterar || testando}
                className="h-9 px-3 rounded-lg bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2 disabled:opacity-50"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">cell_tower</span>
                Simular Evento de Teste (Ping)
              </button>
            </div>
          </section>

          <section aria-label="Diretrizes de Segurança Anti-Ban & Cadência" className={bloco}>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="w-11 h-11 rounded-xl bg-warning-surface text-warning-text flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">shield</span>
              </span>
              <div className="flex-1">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">3. Diretrizes de Segurança Anti-Ban &amp; Cadência</h2>
                <p className="font-body-sm text-body-sm text-text-muted">Proteção do número comercial e ritmo dos disparos em lote</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                <span className="flex items-center justify-between font-label-lg text-label-lg text-text-primary">
                  Intervalo mínimo entre mensagens
                  <span className="font-label-sm text-label-sm text-primary">Aleatório</span>
                </span>
                <span className="font-body-sm text-body-sm text-text-secondary">Espera sorteada entre cada envio de um lote, para imitar o ritmo humano.</span>
                <p className="mt-1 h-10 px-3 rounded-xl bg-surface-card flex items-center font-body-md text-body-md text-text-primary">
                  {INTERVALO_MINIMO_SEGUNDOS} a {INTERVALO_MAXIMO_SEGUNDOS} segundos
                </p>
              </div>
              <div className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                <span className="flex items-center justify-between font-label-lg text-label-lg text-text-primary">
                  Limite de disparos por lote
                  <span className="px-2 py-0.5 rounded-full bg-success-surface text-success-text font-label-sm text-label-sm">Recomendado</span>
                </span>
                <span className="font-body-sm text-body-sm text-text-secondary">Teto de mensagens por disparo em lote, para proteger a reputação do número.</span>
                <p className="mt-1 h-10 px-3 rounded-xl bg-surface-card flex items-center font-body-md text-body-md text-text-primary">{LIMITE_POR_DISPARO} mensagens por lote</p>
              </div>
              <ItemEmBreve rotulo="Digitação humana simulada" icone="keyboard" className="rounded-xl bg-surface-subtle p-3" />
              <ItemEmBreve rotulo="Auto-reconexão inteligente" icone="sync" className="rounded-xl bg-surface-subtle p-3" />
            </div>
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <ItemEmBreve rotulo="Restaurar Padrões de Fábrica" icone="history" className="h-10 px-4 rounded-xl bg-surface-subtle" />
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={!podeAlterar || salvando}
                className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">check</span>
                Salvar Configuração da Instância
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

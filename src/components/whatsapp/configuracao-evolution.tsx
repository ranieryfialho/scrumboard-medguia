'use client';

// T-194 (fase4-whatsapp, US-127): tela "Configurações Técnicas da Evolution API" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/19._whatsapp_configuracao_configura_o_da_inst_ncia/`.
// Só o que existe: o nome da instância é gravado por `POST /api/whatsapp/config`;
// a URL e a chave do servidor, a URL do webhook (segredo mascarado) e os eventos
// vêm de `GET /api/whatsapp/config` (T-193) somente leitura. Diretrizes anti-ban,
// teste de webhook e restaurar padrões não têm backend: "em breve".
import { useCallback, useEffect, useState } from 'react';

import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { EsqueletoCarregando, EstadoErro } from './estados';

interface ConfigView {
  empresaId: string;
  config: Record<string, string>;
  servidor: { urlBase: string | null; chaveConfigurada: boolean };
  webhookUrl: string;
  eventos: string[];
}

const REGEX_INSTANCIA = /^[A-Za-z0-9_-]{1,64}$/;
const ROTULO_DO_EVENTO: Record<string, string> = { MESSAGES_UPSERT: 'Essencial' };
const DESCRICAO_DO_EVENTO: Record<string, string> = {
  MESSAGES_UPSERT: 'Recebimento de novas mensagens em tempo real (texto, áudio, mídia e geolocalização).',
};

const ERROS_DO_SALVAR: Record<string, string> = {
  INSTANCIA_EM_USO: 'Esse nome de instância já está em uso.',
  SEM_PERMISSAO: 'Só MASTER e GERENTE alteram a configuração.',
  REQUISICAO_INVALIDA: 'Use de 1 a 64 letras, números, - ou _ no nome da instância.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

const DIRETRIZES = [
  { rotulo: 'Intervalo mínimo entre mensagens', icone: 'timer' },
  { rotulo: 'Limite de disparos por hora', icone: 'speed' },
  { rotulo: 'Digitação humana simulada', icone: 'keyboard' },
  { rotulo: 'Auto-reconexão inteligente', icone: 'sync' },
];

export function ConfiguracaoEvolution() {
  const [dados, setDados] = useState<ConfigView | null>(null);
  const [erro, setErro] = useState(false);
  const [instancia, setInstancia] = useState('');
  const [podeAlterar, setPodeAlterar] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [verificacao, setVerificacao] = useState<{ ok: boolean; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

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
      setVerificacao({ ok: true, texto: `Servidor respondeu em ${ms} ms (${estado})` });
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

  return (
    <div className="p-space-md space-y-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Configurações Técnicas da Evolution API</h1>
          <p className="font-body-md text-body-md text-text-secondary mt-1 max-w-xl">Servidor de mensagens, webhook e proteção contra banimento do WhatsApp da empresa.</p>
        </div>
        <div className="flex items-center gap-space-sm">
          <ItemEmBreve rotulo="Testar Disparo de Webhook" icone="rss_feed" className="h-10 px-4 rounded-xl bg-surface-card shadow-sm" />
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!podeAlterar || salvando || !dados}
            className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold shadow-md disabled:opacity-50"
          >
            Salvar Alterações
          </button>
        </div>
      </div>

      {resultado && (
        <p role={resultado.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${resultado.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {resultado.texto}
        </p>
      )}
      {erro && <EstadoErro mensagem="Não foi possível carregar a configuração. Tente de novo." onTentarDeNovo={carregar} />}
      {!erro && !dados && <EsqueletoCarregando />}

      {dados && (
        <>
          <section aria-label="Conexão com o Servidor Evolution API" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">1. Conexão com o Servidor Evolution API</h2>
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
            <div className="flex items-center gap-3 flex-wrap rounded-xl bg-surface-subtle p-3">
              <button type="button" onClick={() => void verificarConexao()} className="h-9 px-3 rounded-lg bg-surface-card font-label-md text-label-md font-semibold text-text-primary">
                Verificar Conexão com o Servidor
              </button>
              {verificacao && (
                <span role="status" className={`font-body-sm text-body-sm ${verificacao.ok ? 'text-success-text' : 'text-danger-text'}`}>
                  {verificacao.texto}
                </span>
              )}
            </div>
          </section>

          <section aria-label="Configuração de Webhooks & Eventos" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">2. Configuração de Webhooks &amp; Eventos</h2>
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
              <span className="font-label-md text-label-md text-text-secondary">Eventos registrados</span>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {dados.eventos.map((evento) => (
                  <li key={evento} className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-1">
                    <span className="flex items-center gap-2 font-label-lg text-label-lg text-text-primary">
                      {evento}
                      {ROTULO_DO_EVENTO[evento] && <span className="px-2 py-0.5 rounded-full bg-info-surface text-info-text font-label-sm text-label-sm">{ROTULO_DO_EVENTO[evento]}</span>}
                    </span>
                    {DESCRICAO_DO_EVENTO[evento] && <span className="font-body-sm text-body-sm text-text-secondary">{DESCRICAO_DO_EVENTO[evento]}</span>}
                  </li>
                ))}
              </ul>
            </div>
            <ItemEmBreve rotulo="Simular Evento de Teste (Ping)" icone="cell_tower" className="self-start h-9 px-3 rounded-lg bg-surface-subtle" />
          </section>

          <section aria-label="Diretrizes de Segurança Anti-Ban & Cadência" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">3. Diretrizes de Segurança Anti-Ban &amp; Cadência</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
              {DIRETRIZES.map((d) => (
                <ItemEmBreve key={d.rotulo} rotulo={d.rotulo} icone={d.icone} className="rounded-xl bg-surface-subtle p-3" />
              ))}
            </div>
            <ItemEmBreve rotulo="Restaurar Padrões de Fábrica" icone="history" className="self-start h-9 px-3 rounded-lg bg-surface-subtle" />
          </section>
        </>
      )}
    </div>
  );
}

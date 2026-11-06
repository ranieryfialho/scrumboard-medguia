'use client';

// T-301 (fase4-tarefas-agenda, US-122, AC-765/AC-766): tela "Google Meet" da empresa — liga (ou desliga) a conta Google que cria as salas do
// Meet das reuniões. Quem conecta entra com a conta da empresa (ex.: contato@medguia.com.br) na tela do Google e volta para cá; o token nunca
// aparece. Gerente, master e super admin (a API e o menu barram os demais). O retorno do Google chega na URL (`?conectado=1` ou `?erro=...`).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { AvisoConfig, CabecalhoConfig, SecaoConfig } from './pecas-config';
import { EsqueletoCarregando, EstadoErro } from './estados';

interface Estado {
  configuradoNoServidor: boolean;
  conectado: boolean;
  conta: string | null;
}

const MENSAGENS_DE_ERRO: Record<string, string> = {
  negado: 'A conexão foi cancelada: o Google não recebeu a autorização.',
  estado: 'A conexão expirou ou não pôde ser confirmada. Tente conectar de novo.',
  falha: 'O Google recusou a conexão. Tente de novo; se repetir, confira as credenciais do app no Google Cloud.',
  nao_configurado: 'O servidor ainda não tem as credenciais do Google. Peça a quem cuida do servidor para configurá-las (veja abaixo).',
  segredo: 'O servidor não tem o segredo para guardar a conexão com segurança (SEGREDO_CONFIGURACOES).',
};

export function GoogleMeetEmpresa() {
  const parametros = useSearchParams();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState(false);
  const [trabalhando, setTrabalhando] = useState(false);
  const retorno = parametros.get('erro');

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/integracoes/google');
      if (!r?.ok) throw new Error(`google respondeu ${r?.status}`);
      setEstado((await r.json()) as Estado);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function desconectar() {
    if (!window.confirm('Desconectar o Google Meet? As reuniões novas ficam sem link, e as já criadas continuam no Calendar.')) return;
    setTrabalhando(true);
    try {
      const r = await fetch('/api/integracoes/google', { method: 'DELETE' });
      if (r.ok) setEstado((atual) => (atual ? { ...atual, conectado: false, conta: null } : atual));
    } finally {
      setTrabalhando(false);
    }
  }

  const PASSOS = [
    { titulo: 'Conecte a conta da empresa', texto: 'Entre com a conta Google da empresa (ex.: contato@medguia.com.br) na tela do Google.' },
    { titulo: 'Agende a reunião no card', texto: 'O sistema cria o evento no Calendar e a sala do Meet automaticamente.' },
    { titulo: 'O convite sai por e-mail', texto: 'O lead e o closer recebem o link da sala no convite do Google.' },
  ];

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <CabecalhoConfig
        titulo="Google Meet"
        descricao="A conta Google da empresa cria o evento e a sala do Meet de cada reunião agendada, e convida o lead e o closer por e-mail."
      />

      {parametros.get('conectado') === '1' && <AvisoConfig ok>Google conectado. As próximas reuniões já nascem com a sala do Meet.</AvisoConfig>}
      {retorno && <AvisoConfig ok={false}>{MENSAGENS_DE_ERRO[retorno] ?? 'Não foi possível conectar o Google.'}</AvisoConfig>}

      {erro && <EstadoErro mensagem="Não foi possível carregar o estado do Google." onTentarDeNovo={() => void carregar()} />}
      {!erro && !estado && <EsqueletoCarregando />}

      {estado && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-space-md xl:items-start">
          <SecaoConfig nome="Conta Google" rotulo="Integração" titulo="Conta conectada" icone="videocam">
            <div className={`flex items-center gap-4 rounded-xl p-space-md ${estado.conectado ? 'bg-success-surface' : 'bg-surface-subtle'}`}>
              <span aria-hidden="true" className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${estado.conectado ? 'bg-surface-card text-success-text' : 'bg-surface-card text-text-muted'}`}>
                <span className="material-symbols-outlined text-[26px]">{estado.conectado ? 'videocam' : 'videocam_off'}</span>
              </span>
              <div className="flex flex-col min-w-0">
                <span className={`font-headline-sm text-headline-sm ${estado.conectado ? 'text-success-text' : 'text-text-primary'}`}>{estado.conectado ? 'Conectado' : 'Não conectado'}</span>
                <span className="font-body-md text-body-md text-text-secondary truncate">
                  {estado.conectado ? `Conta: ${estado.conta ?? 'não informada'}` : 'Nenhuma conta Google ligada a esta empresa.'}
                </span>
              </div>
            </div>

            {!estado.configuradoNoServidor && (
              <div role="note" className="rounded-xl bg-warning-surface text-warning-text px-4 py-3 font-body-md text-body-md flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined text-[22px] shrink-0">warning</span>
                <div className="flex flex-col gap-1">
                  <strong>O servidor ainda não tem as credenciais do Google.</strong>
                  <span>
                    Quem cuida do servidor precisa criar o app no Google Cloud (tipo &quot;Interno&quot; do Google Workspace, com a API do Google Calendar ativada) e informar
                    GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET. O endereço de retorno é <code>/api/integracoes/google/callback</code> neste mesmo domínio.
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-space-sm border-t border-border-subtle pt-space-md">
              <div className="flex items-center gap-2 flex-wrap">
                {estado.configuradoNoServidor && (
                  <a
                    href="/api/integracoes/google/conectar"
                    className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md inline-flex items-center gap-2"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
                      link
                    </span>
                    {estado.conectado ? 'Trocar a conta conectada' : 'Conectar com o Google'}
                  </a>
                )}
                {estado.conectado && (
                  <Button type="button" variant="outline" disabled={trabalhando} onClick={() => void desconectar()}>
                    Desconectar
                  </Button>
                )}
              </div>
              <p className="font-body-sm text-body-sm text-text-muted">
                Ao conectar, entre com a conta da empresa. O sistema só pede permissão para criar e mudar eventos no Calendar e para saber o e-mail da conta.
              </p>
            </div>
          </SecaoConfig>

          <section aria-label="Como funciona" className="bg-surface-card rounded-2xl shadow-sm p-space-md flex flex-col gap-space-md">
            <h2 className="font-headline-sm text-headline-sm text-text-primary">Como funciona</h2>
            <ol className="flex flex-col gap-space-md">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="flex gap-3">
                  <span aria-hidden="true" className="w-8 h-8 rounded-full bg-info-surface text-primary flex items-center justify-center shrink-0 font-label-md text-label-md font-semibold">
                    {i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-label-lg text-label-lg text-text-primary">{p.titulo}</span>
                    <span className="font-body-sm text-body-sm text-text-secondary">{p.texto}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

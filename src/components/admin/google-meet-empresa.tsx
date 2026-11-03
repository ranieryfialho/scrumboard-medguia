'use client';

// T-301 (fase4-tarefas-agenda, US-122, AC-765/AC-766): tela "Google Meet" da empresa — liga (ou desliga) a conta Google que cria as salas do
// Meet das reuniões. Quem conecta entra com a conta da empresa (ex.: contato@medguia.com.br) na tela do Google e volta para cá; o token nunca
// aparece. Gerente, master e super admin (a API e o menu barram os demais). O retorno do Google chega na URL (`?conectado=1` ou `?erro=...`).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
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

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary">Google Meet</h1>
        <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
          A conta Google da empresa cria o evento e a sala do Meet de cada reunião agendada, e convida o lead e o closer por e-mail.
        </p>
      </div>

      {parametros.get('conectado') === '1' && (
        <p role="status" className="font-body-md text-body-md rounded-lg px-3 py-2 text-success-text bg-success-surface max-w-2xl">
          Google conectado. As próximas reuniões já nascem com a sala do Meet.
        </p>
      )}
      {retorno && (
        <p role="alert" className="font-body-md text-body-md rounded-lg px-3 py-2 text-danger-text bg-danger-surface max-w-2xl">
          {MENSAGENS_DE_ERRO[retorno] ?? 'Não foi possível conectar o Google.'}
        </p>
      )}

      {erro && <EstadoErro mensagem="Não foi possível carregar o estado do Google." onTentarDeNovo={() => void carregar()} />}
      {!erro && !estado && <EsqueletoCarregando />}

      {estado && (
        <section aria-label="Conta Google" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md max-w-2xl">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className={`w-12 h-12 rounded-xl flex items-center justify-center ${estado.conectado ? 'bg-success-surface text-success-text' : 'bg-surface-subtle text-text-muted'}`}>
              <span className="material-symbols-outlined text-[26px]">{estado.conectado ? 'videocam' : 'videocam_off'}</span>
            </span>
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-text-primary">{estado.conectado ? 'Conectado' : 'Não conectado'}</span>
              <span className="font-body-md text-body-md text-text-secondary">
                {estado.conectado ? `Conta: ${estado.conta ?? 'não informada'}` : 'Nenhuma conta Google ligada a esta empresa.'}
              </span>
            </div>
          </div>

          {!estado.configuradoNoServidor && (
            <div role="note" className="rounded-lg bg-warning-surface text-warning-text px-3 py-2 font-body-md text-body-md flex flex-col gap-1">
              <strong>O servidor ainda não tem as credenciais do Google.</strong>
              <span>
                Quem cuida do servidor precisa criar o app no Google Cloud (tipo &quot;Interno&quot; do Google Workspace, com a API do Google Calendar ativada) e informar
                GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET. O endereço de retorno é <code>/api/integracoes/google/callback</code> neste mesmo domínio.
              </span>
            </div>
          )}

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
        </section>
      )}
    </div>
  );
}

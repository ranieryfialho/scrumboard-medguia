'use client';

// T-261 (fase5-email-config, US-169, AC-694): tela de e-mail da empresa — a chave do Resend (nunca mostrada: só "termina
// em …abcd") e o remetente. Gerente, master e super admin (a API e o menu barram os demais).
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { EsqueletoCarregando, EstadoErro } from './estados';

interface Configuracao {
  chaveConfigurada: boolean;
  chaveFinal: string | null;
  remetente: string | null;
  responderPara?: string;
  /** fase5-email-descadastro (AC-719): só a contagem. */
  descadastrados?: number;
}

export function EmailEmpresa() {
  const [config, setConfig] = useState<Configuracao | null>(null);
  const [chave, setChave] = useState('');
  const [remetente, setRemetente] = useState('');
  const [responderPara, setResponderPara] = useState('');
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [erroDoCampo, setErroDoCampo] = useState<{ campo: string; mensagem: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/configuracoes/email');
      if (!r?.ok) throw new Error(`email respondeu ${r?.status}`);
      const c = (await r.json()) as Configuracao;
      setConfig(c);
      setRemetente(c.remetente ?? '');
      setResponderPara(c.responderPara ?? '');
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(corpo: Record<string, unknown>, sucesso: string) {
    setTrabalhando(true);
    setAviso(null);
    setErroDoCampo(null);
    try {
      const r = await fetch('/api/configuracoes/email', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      if (!r?.ok) {
        const e = (await r.json().catch(() => null)) as { codigo?: string; campo?: string; mensagem?: string } | null;
        if (e?.campo && e.mensagem) setErroDoCampo({ campo: e.campo, mensagem: e.mensagem });
        else setAviso({ ok: false, texto: e?.mensagem ?? 'Não foi possível salvar. Tente de novo.' });
        return;
      }
      setConfig((await r.json()) as Configuracao);
      setChave('');
      setAviso({ ok: true, texto: sucesso });
    } catch {
      setAviso({ ok: false, texto: 'Não foi possível falar com o servidor. Tente de novo.' });
    } finally {
      setTrabalhando(false);
    }
  }

  function salvar() {
    const corpo: Record<string, unknown> = { remetente: remetente.trim() === '' ? null : remetente.trim(), responderPara: responderPara.trim() === '' ? null : responderPara.trim() };
    if (chave.trim() !== '') corpo.chave = chave.trim(); // chave em branco mantém a atual
    void enviar(corpo, 'Configuração salva');
  }

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary">E-mail da Empresa</h1>
        <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
          A chave do Resend e o remetente que a empresa usa nas campanhas de e-mail. A chave fica guardada com segurança e nunca é mostrada de novo.
        </p>
      </div>

      {erro && <EstadoErro mensagem="Não foi possível carregar a configuração." onTentarDeNovo={() => void carregar()} />}
      {!erro && !config && <EsqueletoCarregando />}

      {config && (
        <section aria-label="Configuração de e-mail" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-md max-w-2xl">
          <div className="flex flex-col gap-1">
            <label htmlFor="chave-resend" className="font-label-md text-label-md text-text-secondary">
              Chave do Resend
            </label>
            <p className="font-body-sm text-body-sm text-text-muted">{config.chaveConfigurada ? `Chave configurada (termina em …${config.chaveFinal ?? '????'})` : 'Chave não configurada'}</p>
            <input
              id="chave-resend"
              type="password"
              autoComplete="off"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder={config.chaveConfigurada ? 'Deixe em branco para manter a atual' : 're_…'}
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary"
            />
            {erroDoCampo?.campo === 'chave' && (
              <span role="alert" className="font-body-sm text-body-sm text-danger-text">
                {erroDoCampo.mensagem}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="remetente-resend" className="font-label-md text-label-md text-text-secondary">
              Remetente
            </label>
            <input
              id="remetente-resend"
              value={remetente}
              onChange={(e) => setRemetente(e.target.value)}
              placeholder="Clínica Exemplo <contato@clinica.com.br>"
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary"
            />
            {erroDoCampo?.campo === 'remetente' && (
              <span role="alert" className="font-body-sm text-body-sm text-danger-text">
                {erroDoCampo.mensagem}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="responder-para-resend" className="font-label-md text-label-md text-text-secondary">
              E-mail de resposta
            </label>
            <p className="font-body-sm text-body-sm text-text-muted">Quando o destinatário clicar em &quot;Responder&quot;, a resposta vai para este e-mail. Em branco, vai para o remetente.</p>
            <input
              id="responder-para-resend"
              type="email"
              value={responderPara}
              onChange={(e) => setResponderPara(e.target.value)}
              placeholder="atendimento@clinica.com.br"
              className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary"
            />
            {erroDoCampo?.campo === 'responderPara' && (
              <span role="alert" className="font-body-sm text-body-sm text-danger-text">
                {erroDoCampo.mensagem}
              </span>
            )}
          </div>

          <p className="font-body-sm text-body-sm text-text-muted">
            {config.descadastrados ?? 0} {(config.descadastrados ?? 0) === 1 ? 'e-mail descadastrado' : 'e-mails descadastrados'}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <Button type="button" disabled={trabalhando} onClick={salvar}>
              Salvar configuração
            </Button>
            <Button type="button" variant="outline" disabled={trabalhando || !config.chaveConfigurada} onClick={() => void enviar({ chave: null }, 'Chave removida')}>
              Remover chave
            </Button>
          </div>
          {aviso && (
            <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
              {aviso.texto}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

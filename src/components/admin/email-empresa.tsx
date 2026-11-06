'use client';

// T-261 (fase5-email-config, US-169, AC-694): tela de e-mail da empresa — a chave do Resend (nunca mostrada: só "termina
// em …abcd") e o remetente. Gerente, master e super admin (a API e o menu barram os demais).
import { useCallback, useEffect, useState } from 'react';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { Button } from '@/components/ui/button';
import { AvisoConfig, CabecalhoConfig, CLASSE_CAMPO, SecaoConfig } from './pecas-config';
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

  const pronto = Boolean(config?.chaveConfigurada && config?.remetente);
  const descadastrados = config?.descadastrados ?? 0;

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <CabecalhoConfig
        titulo="E-mail da Empresa"
        descricao="A chave do Resend e o remetente que a empresa usa nas campanhas de e-mail. A chave fica guardada com segurança e nunca é mostrada de novo."
      />

      {erro && <EstadoErro mensagem="Não foi possível carregar a configuração." onTentarDeNovo={() => void carregar()} />}
      {!erro && !config && <EsqueletoCarregando />}

      {config && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-space-md xl:items-start">
          <SecaoConfig nome="Configuração de e-mail" rotulo="Resend" titulo="Chave e remetente" icone="mail">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="chave-resend" className="font-label-md text-label-md text-text-primary">
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
                className={CLASSE_CAMPO}
              />
              {erroDoCampo?.campo === 'chave' && (
                <span role="alert" className="font-body-sm text-body-sm text-danger-text">
                  {erroDoCampo.mensagem}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="remetente-resend" className="font-label-md text-label-md text-text-primary">
                Remetente
              </label>
              <input
                id="remetente-resend"
                value={remetente}
                onChange={(e) => setRemetente(e.target.value)}
                placeholder="Clínica Exemplo <contato@clinica.com.br>"
                className={CLASSE_CAMPO}
              />
              {erroDoCampo?.campo === 'remetente' && (
                <span role="alert" className="font-body-sm text-body-sm text-danger-text">
                  {erroDoCampo.mensagem}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="responder-para-resend" className="font-label-md text-label-md text-text-primary">
                E-mail de resposta
              </label>
              <p className="font-body-sm text-body-sm text-text-muted">Quando o destinatário clicar em &quot;Responder&quot;, a resposta vai para este e-mail. Em branco, vai para o remetente.</p>
              <input
                id="responder-para-resend"
                type="email"
                value={responderPara}
                onChange={(e) => setResponderPara(e.target.value)}
                placeholder="atendimento@clinica.com.br"
                className={CLASSE_CAMPO}
              />
              {erroDoCampo?.campo === 'responderPara' && (
                <span role="alert" className="font-body-sm text-body-sm text-danger-text">
                  {erroDoCampo.mensagem}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-space-sm border-t border-border-subtle pt-space-md">
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" disabled={trabalhando} onClick={salvar}>
                  Salvar configuração
                </Button>
                <Button type="button" variant="outline" disabled={trabalhando || !config.chaveConfigurada} onClick={() => void enviar({ chave: null }, 'Chave removida')}>
                  Remover chave
                </Button>
              </div>
              {aviso && <AvisoConfig ok={aviso.ok}>{aviso.texto}</AvisoConfig>}
            </div>
          </SecaoConfig>

          <div className="flex flex-col gap-space-md">
            <CartaoIndicador
              titulo="Envio de campanhas"
              valor={pronto ? 'Pronto' : 'Incompleto'}
              legenda={pronto ? 'Chave e remetente definidos' : 'Falta a chave ou o remetente'}
              icone={pronto ? 'mark_email_read' : 'unsubscribe'}
              cor={pronto ? 'success' : 'warning'}
            />
            <section aria-label="Descadastros" className="bg-surface-card rounded-2xl shadow-sm p-space-md flex items-center gap-3">
              <span aria-hidden="true" className="w-10 h-10 rounded-xl bg-surface-subtle text-text-secondary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[22px]">person_off</span>
              </span>
              <p className="font-body-md text-body-md text-text-secondary">
                {descadastrados} {descadastrados === 1 ? 'e-mail descadastrado' : 'e-mails descadastrados'}
              </p>
            </section>
            <section aria-label="Dicas" className="bg-surface-card rounded-2xl shadow-sm p-space-md flex flex-col gap-space-sm">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">Antes de enviar</h2>
              <ul className="flex flex-col gap-2 font-body-sm text-body-sm text-text-secondary list-disc pl-5">
                <li>A chave começa com <code>re_</code> e é criada no painel do Resend.</li>
                <li>O remetente precisa usar um domínio verificado no Resend.</li>
                <li>Quem se descadastra deixa de receber as próximas campanhas.</li>
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

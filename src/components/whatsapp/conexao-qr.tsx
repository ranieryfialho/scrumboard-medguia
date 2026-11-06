'use client';

// T-192 (fase4-whatsapp, US-126): tela "Conexão de Instância WhatsApp & QR Code" —
// fonte visual `docs/ui/stitch_medcrm_interface_design/18._whatsapp_conexao_conex_o_e_qr_code/`.
// Usa só o que existe: `GET /api/whatsapp/status` (estado), `GET /api/whatsapp/qrcode`
// (gera o QR, só MASTER/GERENTE) e o `resumo` de `GET /api/whatsapp/conversas`
// (mensagens de hoje). Relê o estado a cada 15 s, e a cada 3 s enquanto mostra o QR.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { CartaoIndicador } from '@/components/pipeline/pecas/cartao-indicador';
import { ItemEmBreve } from '@/components/pipeline/pecas/selo-em-breve';
import { EsqueletoCarregando } from './estados';

interface StatusView {
  state: string;
  instance: string | null;
}

const INTERVALO_MS = 15_000;
const INTERVALO_QR_MS = 3_000;
const VALIDADE_QR_S = 60;

const PASSOS = [
  { titulo: 'Abra o WhatsApp no celular da clínica', texto: 'Use o smartphone dedicado da recepção ou triagem.' },
  { titulo: 'Toque em Aparelhos conectados', texto: 'No Android: Menu > Aparelhos conectados. No iOS: Ajustes > Aparelhos conectados.' },
  { titulo: 'Aponte a câmera para esta tela', texto: 'O pareamento é instantâneo e a fila de mensagens será sincronizada com o CRM.' },
];

const ERROS_DO_QR: Record<string, { texto: string; configurar: boolean }> = {
  WHATSAPP_NAO_CONFIGURADO: { texto: 'O WhatsApp da empresa ainda não tem uma instância configurada.', configurar: true },
  FALHA_EVOLUTION: { texto: 'O servidor do WhatsApp (Evolution) está indisponível. Tente de novo em instantes.', configurar: false },
  SEM_PERMISSAO: { texto: 'Só MASTER e GERENTE podem gerar o QR Code.', configurar: false },
};

function comoImagem(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

export function ConexaoQr() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [erroStatus, setErroStatus] = useState(false);
  const [mensagensHoje, setMensagensHoje] = useState<{ recebidas: number; enviadas: number } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroQr, setErroQr] = useState<{ texto: string; configurar: boolean } | null>(null);
  const [webhookInativo, setWebhookInativo] = useState(false);
  const [podeGerar, setPodeGerar] = useState(true);
  const [latenciaMs, setLatenciaMs] = useState<number | null>(null);
  const [verificadoEm, setVerificadoEm] = useState<Date | null>(null);
  const [restante, setRestante] = useState(VALIDADE_QR_S);
  const [desconectando, setDesconectando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const lerStatus = useCallback(async () => {
    const inicio = performance.now();
    try {
      const r = await fetch('/api/whatsapp/status');
      if (!r.ok) throw new Error(`status respondeu ${r.status}`);
      setStatus((await r.json()) as StatusView);
      setLatenciaMs(Math.round(performance.now() - inicio));
      setVerificadoEm(new Date());
      setErroStatus(false);
    } catch {
      setErroStatus(true);
    }
  }, []);

  useEffect(() => {
    void lerStatus();
    let cancelado = false;
    fetch('/api/whatsapp/conversas?limite=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { resumo?: { mensagensHoje: { recebidas: number; enviadas: number } } } | null) => !cancelado && setMensagensHoje(c?.resumo?.mensagensHoje ?? null))
      .catch(() => undefined);
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u: { papel?: string; isSuperAdmin?: boolean } | null) => {
        if (!cancelado && u) setPodeGerar(u.isSuperAdmin === true || u.papel === 'MASTER' || u.papel === 'GERENTE');
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [lerStatus]);

  // AC-521/AC-519: 15 s normalmente; 3 s enquanto o QR está na tela.
  useEffect(() => {
    const timer = setInterval(() => void lerStatus(), qr ? INTERVALO_QR_MS : INTERVALO_MS);
    return () => clearInterval(timer);
  }, [lerStatus, qr]);

  // AC-519: quando a conexão abre, o QR sai da tela.
  const conectado = status?.state === 'open';
  useEffect(() => {
    if (conectado) setQr(null);
  }, [conectado]);

  // O QR vale cerca de 1 minuto: a contagem aparece na tela e, ao zerar, um novo é gerado sozinho.
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => setRestante((r) => Math.max(r - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [qr]);
  useEffect(() => {
    if (qr && restante === 0 && !gerando) void gerarQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restante, qr]);

  async function desconectar() {
    setDesconectando(true);
    setAviso(null);
    try {
      const r = await fetch('/api/whatsapp/desconectar', { method: 'POST' });
      setAviso(r.ok ? 'Sessão desconectada. Gere um novo QR Code para parear de novo.' : 'Não foi possível desconectar a sessão. Tente de novo.');
      if (r.ok) setQr(null);
      await lerStatus();
    } catch {
      setAviso('Não foi possível desconectar a sessão. Tente de novo.');
    } finally {
      setDesconectando(false);
      setConfirmando(false);
    }
  }

  async function gerarQr() {
    setGerando(true);
    setErroQr(null);
    setWebhookInativo(false);
    setQr(null);
    try {
      const r = await fetch('/api/whatsapp/qrcode');
      const corpo = (await r.json().catch(() => ({}))) as { base64?: string; state?: string; codigo?: string; webhookRegistrado?: boolean };
      if (!r.ok) {
        setErroQr(ERROS_DO_QR[corpo.codigo ?? ''] ?? { texto: 'Não foi possível gerar o QR Code. Tente de novo.', configurar: false });
        return;
      }
      if (corpo.state === 'open') {
        await lerStatus();
        return;
      }
      if (corpo.base64) {
        setQr(corpo.base64);
        setRestante(VALIDADE_QR_S);
      }
      if (corpo.webhookRegistrado === false) setWebhookInativo(true);
    } catch {
      setErroQr({ texto: 'Não foi possível falar com o servidor. Tente de novo.', configurar: false });
    } finally {
      setGerando(false);
    }
  }

  const naoConfigurado = status?.state === 'not_configured';
  const rotuloDoEstado = !status ? '—' : conectado ? 'Conectado' : naoConfigurado ? 'Não configurado' : 'Desconectado';
  const selo = !status
    ? { texto: 'Verificando a conexão...', classe: 'bg-surface-container text-text-secondary' }
    : conectado
      ? { texto: `Sessão ativa: Instância ${status.instance ?? ''}`.trim(), classe: 'bg-success-surface text-success-text' }
      : naoConfigurado
        ? { texto: 'WhatsApp não configurado', classe: 'bg-warning-surface text-warning-text' }
        : { texto: 'Sessão desconectada', classe: 'bg-danger-surface text-danger-text' };

  const bloco = 'bg-surface-card rounded-2xl shadow-sm';
  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-space-md flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">Conexão de Instância WhatsApp &amp; QR Code</h1>
            <span className={`px-3 py-1 rounded-full font-label-md text-label-md ${selo.classe}`}>{selo.texto}</span>
          </div>
          <p className="font-body-md text-body-md text-text-secondary">Gestão de pareamento em tempo real via Evolution API e estado da sessão de WhatsApp da empresa.</p>
        </div>
        <div className="flex items-center gap-space-sm">
          <button type="button" onClick={() => void lerStatus()} className="h-10 px-4 rounded-xl bg-surface-card shadow-sm font-label-md text-label-md font-semibold text-text-primary flex items-center gap-2">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">sync</span>
            Atualizar Status
          </button>
          {confirmando ? (
            <span className="flex items-center gap-2 h-10 px-3 rounded-xl bg-danger-surface">
              <span className="font-label-md text-label-md text-danger-text">Desconectar a sessão?</span>
              <button type="button" onClick={() => void desconectar()} disabled={desconectando} className="h-8 px-3 rounded-lg bg-danger-text text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50">
                {desconectando ? 'Desconectando...' : 'Sim, desconectar'}
              </button>
              <button type="button" onClick={() => setConfirmando(false)} className="font-label-md text-label-md text-text-secondary">
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              disabled={!conectado || !podeGerar}
              className="h-10 px-4 rounded-xl bg-danger-surface font-label-md text-label-md font-semibold text-danger-text flex items-center gap-2 disabled:opacity-50"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">power_settings_new</span>
              Desconectar Sessão
            </button>
          )}
        </div>
      </div>

      {erroStatus && (
        <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2 shrink-0">
          Não foi possível consultar o estado da conexão.{' '}
          <button type="button" onClick={() => void lerStatus()} className="font-semibold underline">
            Tentar de novo
          </button>
        </p>
      )}
      {aviso && (
        <p role="status" className="font-body-sm text-body-sm text-text-secondary bg-surface-card rounded-lg px-3 py-2 shrink-0">
          {aviso}
        </p>
      )}
      {!status && !erroStatus && <EsqueletoCarregando linhas={2} />}

      {status && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md shrink-0">
            <CartaoIndicador titulo="Status da conexão" valor={rotuloDoEstado} legenda={status.instance ? `Instância ${status.instance}` : 'Sem instância'} icone="wifi_tethering" cor={conectado ? 'success' : 'danger'} />
            <CartaoIndicador
              titulo="Latência da consulta"
              valor={latenciaMs !== null ? `${latenciaMs}ms` : '—'}
              legenda={latenciaMs === null ? 'Sem medição' : latenciaMs < 300 ? 'Excelente' : latenciaMs < 1000 ? 'Boa' : 'Lenta'}
              icone="speed"
              cor={latenciaMs !== null && latenciaMs >= 1000 ? 'warning' : 'primary'}
            />
            <CartaoIndicador
              titulo="Mensagens de hoje"
              valor={mensagensHoje ? String(mensagensHoje.recebidas + mensagensHoje.enviadas) : '—'}
              legenda={mensagensHoje ? `${mensagensHoje.recebidas} recebidas · ${mensagensHoje.enviadas} enviadas` : 'Sem dados'}
              icone="forum"
            />
            <CartaoIndicador titulo="Instância pareada" valor={status.instance ?? '—'} legenda={conectado ? 'WhatsApp conectado' : 'Aguardando pareamento'} icone="smartphone" cor="warning" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-space-md xl:items-start">
            <section aria-label="Leitor de QR Code" className={`${bloco} p-space-md flex flex-col gap-space-md`}>
              <div className="flex flex-col">
                <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Pareamento Evolution</span>
                <h2 className="font-headline-sm text-headline-sm text-text-primary">Leitor de QR Code para Sincronização</h2>
              </div>
              {conectado ? (
                // Já pareado: não há QR para mostrar, então o bloco encolhe para um aviso do tamanho do conteúdo.
                <div role="status" className="flex items-center gap-3 rounded-xl bg-success-surface px-4 py-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-success-text">check_circle</span>
                  <span className="flex flex-col">
                    <span className="font-label-lg text-label-lg text-success-text font-semibold">Pareamento concluído</span>
                    <span className="font-body-sm text-body-sm text-success-text/80">
                      A sessão está ativa{status.instance ? ` na instância ${status.instance}` : ''}. Para parear outro aparelho, desconecte a sessão.
                    </span>
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md items-center rounded-2xl bg-surface-subtle p-space-md">
                  <div className="flex flex-col items-center justify-center gap-2 min-h-56">
                    {qr ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={comoImagem(qr)} alt="QR Code WhatsApp" className="w-56 h-56 bg-white p-2 rounded-xl" />
                        <div className="w-56 flex flex-col gap-1">
                          <div className="flex items-center justify-between font-body-sm text-body-sm text-text-muted">
                            <span>
                              Expira em <strong className="text-primary">{restante}s</strong>
                            </span>
                            <span>Auto-refresh</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${(restante / VALIDADE_QR_S) * 100}%` }} />
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="font-body-md text-body-md text-text-secondary text-center">Clique em &quot;Gerar Novo QR Code&quot; para parear o aparelho.</p>
                    )}
                  </div>
                  <ol className="flex flex-col gap-3">
                    {PASSOS.map((p, i) => (
                      <li key={p.titulo} className="flex gap-3">
                        <span aria-hidden="true" className="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md shrink-0">
                          {i + 1}
                        </span>
                        <span className="flex flex-col">
                          <span className="font-label-lg text-label-lg text-text-primary">{p.titulo}</span>
                          <span className="font-body-sm text-body-sm text-text-secondary">{p.texto}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {erroQr && (
                <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
                  {erroQr.texto}{' '}
                  {erroQr.configurar && (
                    <Link href="/whatsapp/configuracao" className="font-semibold underline">
                      Configurar o WhatsApp
                    </Link>
                  )}
                </p>
              )}
              {webhookInativo && (
                <p role="status" className="font-body-sm text-body-sm text-warning-text bg-warning-surface rounded-lg px-3 py-2">
                  Atenção: a entrada de mensagens (webhook) não foi ativada. O QR Code funciona, mas as respostas dos leads não chegarão ao CRM até isso ser corrigido.
                </p>
              )}
              {!conectado && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void gerarQr()}
                    disabled={gerando || !podeGerar}
                    className="h-11 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-md disabled:opacity-50 flex items-center gap-2"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px]">qr_code_2</span>
                    {gerando ? 'Gerando...' : 'Gerar Novo QR Code'}
                  </button>
                  <ItemEmBreve rotulo="Código Numérico (Pairing)" icone="pin" className="h-11 px-4 rounded-xl bg-surface-subtle" />
                  {!podeGerar && <span className="font-body-sm text-body-sm text-text-muted">Só MASTER e GERENTE geram o QR Code.</span>}
                </div>
              )}
            </section>

            <div className="flex flex-col gap-space-md">
              <section aria-label="Instâncias" className={`${bloco} p-space-md flex flex-col gap-space-sm`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">Multi-linhas</span>
                    <h2 className="font-headline-sm text-headline-sm text-text-primary">Instâncias</h2>
                  </div>
                  <ItemEmBreve rotulo="Nova Instância" icone="add" className="h-9 px-3 rounded-lg bg-surface-subtle" />
                </div>
                <article className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${conectado ? 'bg-success-text' : 'bg-danger-text'}`} />
                      <span className="font-label-lg text-label-lg text-text-primary truncate">{status.instance ?? 'Sem instância'}</span>
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm ${conectado ? 'bg-success-surface text-success-text' : 'bg-danger-surface text-danger-text'}`}>{rotuloDoEstado}</span>
                  </div>
                  {status.instance && <span className="px-2 py-0.5 w-fit rounded bg-info-surface text-primary font-label-sm text-label-sm uppercase">Principal</span>}
                  {!conectado && !naoConfigurado && (
                    <button type="button" onClick={() => void gerarQr()} disabled={gerando || !podeGerar} className="self-start h-9 px-3 rounded-lg bg-surface-card font-label-md text-label-md font-semibold text-text-primary disabled:opacity-50">
                      Reconectar
                    </button>
                  )}
                </article>
              </section>

              <section aria-label="Diagnóstico em Tempo Real" className={`${bloco} p-space-md flex flex-col gap-space-sm`}>
                <div className="flex items-center justify-between">
                  <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-primary">monitor_heart</span>
                    Diagnóstico em Tempo Real
                  </h2>
                  <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${erroStatus ? 'bg-danger-text' : 'bg-success-text'}`} />
                </div>
                {[
                  { titulo: 'Consulta à Evolution API', detalhe: 'Estado da instância', valor: erroStatus ? 'Falha' : `OK${latenciaMs !== null ? ` · ${latenciaMs}ms` : ''}`, ok: !erroStatus },
                  { titulo: 'Sessão do WhatsApp', detalhe: status.instance ? `Instância ${status.instance}` : 'Sem instância', valor: conectado ? 'Conectada' : naoConfigurado ? 'Não configurada' : 'Desconectada', ok: conectado },
                  { titulo: 'Atualização automática', detalhe: verificadoEm ? `Última verificação às ${verificadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Aguardando a primeira leitura', valor: qr ? 'A cada 3s' : 'A cada 15s', ok: true },
                ].map((d) => (
                  <div key={d.titulo} className="rounded-xl bg-surface-subtle p-3 flex items-center justify-between gap-3">
                    <span className="flex flex-col min-w-0">
                      <span className="font-label-md text-label-md text-text-primary font-semibold">{d.titulo}</span>
                      <span className="font-body-sm text-body-sm text-text-muted truncate">{d.detalhe}</span>
                    </span>
                    <span className={`px-2 py-0.5 rounded font-label-sm text-label-sm shrink-0 ${d.ok ? 'bg-success-surface text-success-text' : 'bg-danger-surface text-danger-text'}`}>{d.valor}</span>
                  </div>
                ))}
                <Link href="/whatsapp/configuracao" className="font-label-md text-label-md text-primary font-semibold hover:underline flex items-center justify-between">
                  Alterar URL do webhook ou token: Configurações Evolution
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </Link>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

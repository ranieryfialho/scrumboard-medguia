'use client';

// T-253 (fase5-whatsapp-lote-disparo, US-165, AC-685): o diálogo "Disparar WhatsApp" da lista — escolhe um template
// aprovado, mostra a prévia (quantos recebem, quantos ficam de fora e por quê, duração estimada) e só confirma com pelo
// menos um elegível. O servidor recalcula tudo ao criar o lote; aqui é só conferência.
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Template {
  id: string;
  nome: string;
}
interface Previa {
  elegiveis: Array<{ leadId: string }>;
  excluidos: Array<{ leadId: string; nome: string | null; motivo: string }>;
  limite: number;
  duracaoEstimadaSegundos: number;
}

const MOTIVO: Record<string, string> = {
  SEM_CONSENTIMENTO: 'sem consentimento para WhatsApp',
  SEM_TELEFONE: 'sem telefone',
  TELEFONE_REPETIDO: 'telefone repetido na seleção',
  ACIMA_DO_LIMITE: 'acima do limite por disparo',
  LEAD_NAO_ENCONTRADO: 'lead não encontrado',
};
const ERRO: Record<string, string> = {
  TEMPLATE_NAO_APROVADO: 'Este template não está aprovado.',
  TEMPLATE_NAO_ENCONTRADO: 'Template não encontrado.',
  SEM_DESTINATARIOS: 'Nenhum lead da seleção pode receber a mensagem.',
  WHATSAPP_NAO_CONFIGURADO: 'O WhatsApp da empresa não está configurado.',
  LOTE_EM_ANDAMENTO: 'Já existe um lote em andamento. Espere terminar ou cancele-o.',
  SEM_PERMISSAO: 'Você não tem permissão para disparar em lote.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

function duracao(segundos: number): string {
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.round(segundos / 60);
  return `cerca de ${minutos} min`;
}

export function DialogoWhatsappLote({ oportunidadeIds, onFechar }: { oportunidadeIds: string[]; onFechar: () => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [criado, setCriado] = useState<{ total: number } | null>(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await fetch('/api/whatsapp/templates');
        const corpo = r?.ok ? ((await r.json()) as { templates: Array<Template & { status: string }> }) : { templates: [] };
        if (ativo) setTemplates(corpo.templates.filter((t) => t.status === 'aprovado'));
      } catch {
        if (ativo) setTemplates([]);
      }
    })();
    return () => {
      ativo = false;
    };
  }, []);

  async function escolher(id: string) {
    setTemplateId(id);
    setPrevia(null);
    setErro(null);
    if (!id) return;
    setTrabalhando(true);
    try {
      const r = await fetch('/api/whatsapp/lote/previa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId: id, oportunidadeIds }) });
      const corpo = (await r.json().catch(() => ({}))) as Previa & { codigo?: string; mensagem?: string };
      if (!r.ok) setErro(corpo.mensagem ?? (corpo.codigo && ERRO[corpo.codigo]) ?? 'Não foi possível calcular a prévia.');
      else setPrevia(corpo);
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setTrabalhando(false);
    }
  }

  async function confirmar() {
    setTrabalhando(true);
    setErro(null);
    try {
      const r = await fetch('/api/whatsapp/lote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId, oportunidadeIds }) });
      const corpo = (await r.json().catch(() => ({}))) as { codigo?: string; total?: number };
      if (!r.ok) setErro((corpo.codigo && ERRO[corpo.codigo]) || 'Não foi possível criar o lote. Tente de novo.');
      else setCriado({ total: corpo.total ?? 0 });
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setTrabalhando(false);
    }
  }

  const elegiveis = previa?.elegiveis.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-space-md">
      <div role="dialog" aria-modal="true" aria-label="Disparar WhatsApp" className="bg-surface-card rounded-2xl shadow-xl w-full max-w-lg p-space-lg flex flex-col gap-space-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-headline-md text-headline-md text-text-primary">Disparar WhatsApp</h2>
            <p className="font-body-sm text-body-sm text-text-secondary">
              {oportunidadeIds.length} {oportunidadeIds.length === 1 ? 'card selecionado' : 'cards selecionados'}.
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-text-muted hover:text-text-primary">
            <span aria-hidden="true" className="material-symbols-outlined">close</span>
          </button>
        </div>

        {criado ? (
          <div role="status" className="flex flex-col gap-2 rounded-xl bg-success-surface p-3 text-success-text">
            <p className="font-label-lg text-label-lg">Lote criado: {criado.total} {criado.total === 1 ? 'mensagem entra' : 'mensagens entram'} na fila.</p>
            <Link href="/whatsapp/lote" className="font-label-md text-label-md font-semibold underline">
              Acompanhar envio
            </Link>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
              Template aprovado
              <select value={templateId} onChange={(e) => void escolher(e.target.value)} aria-label="Template aprovado" className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary">
                <option value="">{templates === null ? 'Carregando…' : 'Escolha o template'}</option>
                {(templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </label>
            {templates !== null && templates.length === 0 && <p className="font-body-sm text-body-sm text-text-muted">Nenhum template aprovado. Aprove um em Comunicação, Templates.</p>}

            {previa && (
              <section aria-label="Prévia do lote" className="rounded-xl bg-surface-subtle p-3 flex flex-col gap-2">
                <p className="font-label-lg text-label-lg text-text-primary">
                  {elegiveis} {elegiveis === 1 ? 'receberá a mensagem' : 'receberão a mensagem'} · duração estimada {duracao(previa.duracaoEstimadaSegundos)}
                </p>
                <p className="font-body-sm text-body-sm text-text-muted">Limite de {previa.limite} por disparo, com 15 a 45 segundos entre as mensagens.</p>
                {previa.excluidos.length > 0 && (
                  <div>
                    <p className="font-label-md text-label-md text-warning-text">{previa.excluidos.length} {previa.excluidos.length === 1 ? 'fica de fora' : 'ficam de fora'}:</p>
                    <ul className="font-body-sm text-body-sm text-text-secondary list-disc pl-5 max-h-40 overflow-y-auto">
                      {previa.excluidos.map((e) => (
                        <li key={e.leadId}>
                          {e.nome ?? 'Lead não encontrado'} — {MOTIVO[e.motivo] ?? e.motivo}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {erro && (
              <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
                {erro}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onFechar} className="h-10 px-4 rounded-xl bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                Cancelar
              </button>
              <button
                type="button"
                disabled={trabalhando || elegiveis === 0}
                onClick={() => void confirmar()}
                className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50"
              >
                Confirmar envio{elegiveis > 0 ? ` de ${elegiveis} ${elegiveis === 1 ? 'mensagem' : 'mensagens'}` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

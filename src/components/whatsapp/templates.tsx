'use client';

// T-248 (fase5-whatsapp-lote-base, US-160, AC-673): tela de templates de mensagem do WhatsApp. Todos leem; gerente,
// master e super admin criam, editam, aprovam e arquivam (a API decide: `podeGerir`). Só o template aprovado vale em
// lote; editar um aprovado o devolve a rascunho. As variáveis são {{nome}} e {{primeiro_nome}}.
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { renderizarTemplate } from '@/lib/whatsapp/template';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';

interface Template {
  id: string;
  nome: string;
  corpo: string;
  status: 'rascunho' | 'aprovado' | 'arquivado';
  aprovadoPorNome: string | null;
}

const ROTULO: Record<Template['status'], string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', arquivado: 'Arquivado' };
const COR: Record<Template['status'], string> = {
  rascunho: 'bg-warning-surface text-warning-text',
  aprovado: 'bg-success-surface text-success-text',
  arquivado: 'bg-surface-container text-text-muted',
};
const MENSAGENS: Record<string, string> = {
  TEMPLATE_JA_EXISTE: 'Já existe um template com esse nome.',
  TEMPLATE_ARQUIVADO: 'Template arquivado não pode ser alterado.',
  TEMPLATE_NAO_ENCONTRADO: 'Template não encontrado.',
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};
const EXEMPLO = 'Maria Souza';

export function Templates() {
  const [lista, setLista] = useState<Template[] | null>(null);
  const [podeGerir, setPodeGerir] = useState(false);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [formulario, setFormulario] = useState<{ id: string | null; nome: string; corpo: string } | null>(null);
  const [erroDoCampo, setErroDoCampo] = useState<{ campo: string; mensagem: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/whatsapp/templates');
      if (!r?.ok) throw new Error(`templates respondeu ${r?.status}`);
      const corpo = (await r.json()) as { templates: Template[]; podeGerir: boolean };
      setLista(corpo.templates);
      setPodeGerir(corpo.podeGerir);
      setErro(false);
    } catch {
      setErro(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(url: string, metodo: string, corpo: unknown, sucesso: string): Promise<boolean> {
    setTrabalhando(true);
    setAviso(null);
    setErroDoCampo(null);
    try {
      const r = await fetch(url, { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      if (!r?.ok) {
        const e = (await r.json().catch(() => null)) as { codigo?: string; campo?: string; mensagem?: string } | null;
        if (e?.campo && e.mensagem) setErroDoCampo({ campo: e.campo, mensagem: e.mensagem });
        else setAviso({ ok: false, texto: (e?.codigo && MENSAGENS[e.codigo]) || 'Não foi possível concluir a ação. Tente de novo.' });
        return false;
      }
      setAviso({ ok: true, texto: sucesso });
      await carregar();
      return true;
    } catch {
      setAviso({ ok: false, texto: 'Não foi possível falar com o servidor. Tente de novo.' });
      return false;
    } finally {
      setTrabalhando(false);
    }
  }

  async function salvar() {
    if (!formulario) return;
    const corpo = { nome: formulario.nome, corpo: formulario.corpo };
    const ok = formulario.id
      ? await enviar(`/api/whatsapp/templates/${formulario.id}`, 'PATCH', corpo, 'Template salvo')
      : await enviar('/api/whatsapp/templates', 'POST', corpo, 'Template criado como rascunho');
    if (ok) setFormulario(null);
  }

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary">Templates de Mensagem</h1>
          <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
            Modelos de mensagem do WhatsApp. Só um template <strong>aprovado</strong> pode ser usado em lote. Use <code>{'{{nome}}'}</code> ou <code>{'{{primeiro_nome}}'}</code> para personalizar.
          </p>
        </div>
        {podeGerir && (
          <Button type="button" onClick={() => { setErroDoCampo(null); setFormulario({ id: null, nome: '', corpo: '' }); }}>
            Novo template
          </Button>
        )}
      </div>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
        </p>
      )}

      {formulario && (
        <section aria-label="Template" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-text-primary">{formulario.id ? 'Editar template' : 'Novo template'}</h2>
          <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
            Nome do template
            <input value={formulario.nome} onChange={(e) => setFormulario({ ...formulario, nome: e.target.value })} aria-label="Nome do template" className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary" />
            {erroDoCampo?.campo === 'nome' && <span role="alert" className="text-danger-text">{erroDoCampo.mensagem}</span>}
          </label>
          <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
            Mensagem
            <textarea value={formulario.corpo} onChange={(e) => setFormulario({ ...formulario, corpo: e.target.value })} aria-label="Mensagem do template" rows={5} className="px-3 py-2 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary" />
            {erroDoCampo?.campo === 'corpo' && <span role="alert" className="text-danger-text">{erroDoCampo.mensagem}</span>}
          </label>
          <p className="font-body-sm text-body-sm text-text-muted">Prévia para &quot;{EXEMPLO}&quot;: {renderizarTemplate(formulario.corpo, EXEMPLO) || '—'}</p>
          <div className="flex items-center gap-2">
            <Button type="button" disabled={trabalhando} onClick={() => void salvar()}>
              Salvar template
            </Button>
            <Button type="button" variant="outline" onClick={() => setFormulario(null)}>
              Cancelar
            </Button>
          </div>
        </section>
      )}

      {erro && <EstadoErro mensagem="Não foi possível carregar os templates." onTentarDeNovo={() => void carregar()} />}
      {!erro && !lista && <EsqueletoCarregando />}
      {lista && lista.length === 0 && <EstadoVazio titulo="Nenhum template ainda" proximoPasso={podeGerir ? 'crie o primeiro em Novo template' : 'peça a um gerente para aprovar um template'} icone="article" />}
      {lista && lista.length > 0 && (
        <section aria-label="Templates" className="flex flex-col gap-space-sm">
          {lista.map((t) => (
            <article key={t.id} aria-label={`Template ${t.nome}`} className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-headline-sm text-headline-sm text-text-primary">{t.nome}</h2>
                <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR[t.status]}`}>{ROTULO[t.status]}</span>
              </div>
              <p className="font-body-md text-body-md text-text-secondary whitespace-pre-wrap">{renderizarTemplate(t.corpo, EXEMPLO)}</p>
              <p className="font-body-sm text-body-sm text-text-muted">Prévia com &quot;{EXEMPLO}&quot;{t.status === 'aprovado' && t.aprovadoPorNome ? ` · aprovado por ${t.aprovadoPorNome}` : ''}</p>
              {podeGerir && t.status !== 'arquivado' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" disabled={trabalhando} onClick={() => { setErroDoCampo(null); setFormulario({ id: t.id, nome: t.nome, corpo: t.corpo }); }} aria-label={`Editar: ${t.nome}`} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                    Editar
                  </button>
                  {t.status === 'rascunho' && (
                    <button type="button" disabled={trabalhando} onClick={() => void enviar(`/api/whatsapp/templates/${t.id}`, 'PATCH', { acao: 'aprovar' }, 'Template aprovado')} aria-label={`Aprovar: ${t.nome}`} className="h-9 px-3 rounded-lg bg-success-surface font-label-md text-label-md font-semibold text-success-text">
                      Aprovar
                    </button>
                  )}
                  <button type="button" disabled={trabalhando} onClick={() => void enviar(`/api/whatsapp/templates/${t.id}`, 'PATCH', { acao: 'arquivar' }, 'Template arquivado')} aria-label={`Arquivar: ${t.nome}`} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                    Arquivar
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

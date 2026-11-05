'use client';

// T-248 (fase5-whatsapp-lote-base, US-160, AC-673): tela de templates de mensagem do WhatsApp. Todos leem; gerente,
// master e super admin criam, editam, aprovam e arquivam (a API decide: `podeGerir`). Só o template aprovado vale em
// lote; editar um aprovado o devolve a rascunho. Os shortcodes vêm do catálogo único (`VARIAVEIS`).
// Layout lista + painel: a lista fica sempre à esquerda; à direita, o template escolhido (prévia e ações) ou o editor
// (campos, shortcodes por grupo e prévia ao vivo) — nada obriga a rolar a página para achar um shortcode.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CONTEXTO_DE_EXEMPLO, CORPO_MAXIMO, VARIAVEIS, renderizarTemplate, type DefinicaoDaVariavel, type GrupoDaVariavel } from '@/lib/whatsapp/template';
import { EsqueletoCarregando, EstadoErro, EstadoVazio } from '@/components/pipeline/pecas/estados';

interface Template {
  id: string;
  nome: string;
  corpo: string;
  status: 'rascunho' | 'aprovado' | 'arquivado';
  aprovadoPorNome: string | null;
}

type Filtro = 'todos' | Template['status'];

const ROTULO: Record<Template['status'], string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', arquivado: 'Arquivado' };
const COR: Record<Template['status'], string> = {
  rascunho: 'bg-warning-surface text-warning-text',
  aprovado: 'bg-success-surface text-success-text',
  arquivado: 'bg-surface-container text-text-muted',
};
const FILTROS: Array<[Filtro, string]> = [
  ['todos', 'Todos'],
  ['aprovado', 'Aprovados'],
  ['rascunho', 'Rascunhos'],
  ['arquivado', 'Arquivados'],
];
const GRUPOS: GrupoDaVariavel[] = ['Lead', 'Card', 'Reunião', 'Empresa e data'];
const ICONE_DO_GRUPO: Record<GrupoDaVariavel, string> = { Lead: 'person', Card: 'view_kanban', Reunião: 'videocam', 'Empresa e data': 'event' };
const MENSAGENS: Record<string, string> = {
  TEMPLATE_JA_EXISTE: 'Já existe um template com esse nome.',
  TEMPLATE_ARQUIVADO: 'Template arquivado não pode ser alterado.',
  TEMPLATE_NAO_ENCONTRADO: 'Template não encontrado.',
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};
const EXEMPLO = CONTEXTO_DE_EXEMPLO.nome as string;

/** A mensagem como o lead a veria, num balão de conversa. */
function Balao({ corpo }: { corpo: string }) {
  const texto = renderizarTemplate(corpo, CONTEXTO_DE_EXEMPLO);
  return (
    <div className="rounded-xl bg-surface-subtle/60 p-space-md flex flex-col gap-2" aria-label="Prévia da mensagem">
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-primary text-on-primary px-space-md py-space-sm shadow-sm">
          <p className="font-body-md text-body-md whitespace-pre-wrap break-words">{texto || '—'}</p>
          <p className="mt-1 text-right font-label-sm text-[11px] opacity-80">agora</p>
        </div>
      </div>
      <p className="font-body-sm text-body-sm text-text-muted">Prévia para &quot;{EXEMPLO}&quot;</p>
    </div>
  );
}

export function Templates() {
  const [lista, setLista] = useState<Template[] | null>(null);
  const [podeGerir, setPodeGerir] = useState(false);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [formulario, setFormulario] = useState<{ id: string | null; nome: string; corpo: string } | null>(null);
  const [erroDoCampo, setErroDoCampo] = useState<{ campo: string; mensagem: string } | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [escolhidoId, setEscolhidoId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [grupo, setGrupo] = useState<GrupoDaVariavel>('Lead');
  const [dica, setDica] = useState<DefinicaoDaVariavel | null>(null);
  const campoDaMensagem = useRef<HTMLTextAreaElement>(null);

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

  /** Coloca o shortcode onde está o cursor da mensagem (ou no fim, se o campo nunca foi tocado). */
  function inserir(variavel: string) {
    if (!formulario) return;
    const campo = campoDaMensagem.current;
    const inicio = campo?.selectionStart ?? formulario.corpo.length;
    const fim = campo?.selectionEnd ?? inicio;
    const codigo = `{{${variavel}}}`;
    setFormulario({ ...formulario, corpo: formulario.corpo.slice(0, inicio) + codigo + formulario.corpo.slice(fim) });
    const posicao = inicio + codigo.length;
    setTimeout(() => {
      campo?.focus();
      campo?.setSelectionRange(posicao, posicao);
    }, 0);
  }

  async function salvar() {
    if (!formulario) return;
    const corpo = { nome: formulario.nome, corpo: formulario.corpo };
    const ok = formulario.id
      ? await enviar(`/api/whatsapp/templates/${formulario.id}`, 'PATCH', corpo, 'Template salvo')
      : await enviar('/api/whatsapp/templates', 'POST', corpo, 'Template criado como rascunho');
    if (ok) setFormulario(null);
  }

  function abrirEditor(f: { id: string | null; nome: string; corpo: string }) {
    setErroDoCampo(null);
    setDica(null);
    setFormulario(f);
  }

  const contagens = useMemo(() => {
    const c: Record<Filtro, number> = { todos: lista?.length ?? 0, aprovado: 0, rascunho: 0, arquivado: 0 };
    for (const t of lista ?? []) c[t.status] += 1;
    return c;
  }, [lista]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (lista ?? []).filter((t) => (filtro === 'todos' || t.status === filtro) && (!termo || t.nome.toLowerCase().includes(termo) || t.corpo.toLowerCase().includes(termo)));
  }, [lista, busca, filtro]);

  const escolhido = lista?.find((t) => t.id === escolhidoId) ?? null;
  const painelAberto = formulario !== null || escolhido !== null;
  const variaveisDoGrupo = VARIAVEIS.filter((v) => v.grupo === grupo);

  return (
    <div className="p-space-md flex flex-col gap-space-md">
      <div className="flex items-start justify-between flex-wrap gap-space-md">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary">Templates de Mensagem</h1>
          <p className="font-body-md text-body-md text-text-secondary max-w-2xl">
            Modelos de mensagem do WhatsApp. Só um template <strong>aprovado</strong> aparece nas conversas e pode ser usado em lote.
          </p>
        </div>
        {podeGerir && (
          <Button type="button" onClick={() => abrirEditor({ id: null, nome: '', corpo: '' })}>
            Novo template
          </Button>
        )}
      </div>

      {aviso && (
        <p role={aviso.ok ? 'status' : 'alert'} className={`font-body-md text-body-md rounded-lg px-3 py-2 ${aviso.ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}>
          {aviso.texto}
        </p>
      )}

      {erro && <EstadoErro mensagem="Não foi possível carregar os templates." onTentarDeNovo={() => void carregar()} />}
      {!erro && !lista && <EsqueletoCarregando />}
      {lista && lista.length === 0 && !formulario && (
        <EstadoVazio titulo="Nenhum template ainda" proximoPasso={podeGerir ? 'crie o primeiro em Novo template' : 'peça a um gerente para aprovar um template'} icone="article" />
      )}

      {lista && (lista.length > 0 || formulario) && (
        <div className="grid grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)] gap-space-md xl:h-[calc(100dvh-14rem)] xl:min-h-[34rem]">
          <section aria-label="Templates" className={`${painelAberto ? 'hidden xl:flex' : 'flex'} bg-surface-card rounded-2xl shadow-sm flex-col min-h-0 overflow-hidden`}>
            <div className="p-space-sm border-b border-border-subtle flex flex-col gap-2 shrink-0">
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar templates"
                placeholder="Buscar por nome ou texto…"
                className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {podeGerir && (
                <div role="tablist" aria-label="Filtrar por situação" className="flex flex-wrap gap-1">
                  {FILTROS.map(([valor, rotulo]) => (
                    <button
                      key={valor}
                      type="button"
                      role="tab"
                      aria-selected={filtro === valor}
                      onClick={() => setFiltro(valor)}
                      className={`h-8 px-3 rounded-full font-label-md text-label-md ${filtro === valor ? 'bg-primary text-on-primary font-semibold' : 'bg-surface-subtle text-text-secondary hover:bg-surface-container'}`}
                    >
                      {rotulo} ({contagens[valor]})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ul className="flex-1 min-h-0 overflow-y-auto p-space-sm flex flex-col gap-2">
              {visiveis.length === 0 && <li className="p-space-md text-center font-body-md text-body-md text-text-muted">Nenhum template encontrado.</li>}
              {visiveis.map((t) => {
                const ativo = escolhidoId === t.id && !formulario;
                return (
                  <li key={t.id}>
                    <article aria-label={`Template ${t.nome}`}>
                      <button
                        type="button"
                        aria-pressed={ativo}
                        onClick={() => {
                          setFormulario(null);
                          setEscolhidoId(t.id);
                        }}
                        className={`w-full text-left rounded-xl p-3 flex flex-col gap-1 border ${ativo ? 'border-primary bg-info-surface' : 'border-transparent bg-surface-subtle hover:bg-surface-container'}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-label-lg text-label-lg font-semibold text-text-primary truncate">{t.nome}</span>
                          <span className={`px-2 py-0.5 rounded-full font-label-sm text-label-sm shrink-0 ${COR[t.status]}`}>{ROTULO[t.status]}</span>
                        </span>
                        <span className="font-body-sm text-body-sm text-text-secondary line-clamp-2 break-words">{renderizarTemplate(t.corpo, CONTEXTO_DE_EXEMPLO)}</span>
                      </button>
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Painel do template" className={`${painelAberto ? 'flex' : 'hidden xl:flex'} bg-surface-card rounded-2xl shadow-sm flex-col min-h-0 overflow-y-auto`}>
            <div className="p-space-md flex flex-col gap-space-md">
              <button
                type="button"
                onClick={() => {
                  setFormulario(null);
                  setEscolhidoId(null);
                }}
                className="xl:hidden self-start h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md text-text-primary flex items-center gap-1"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  arrow_back
                </span>
                Voltar à lista
              </button>

              {formulario && (
                <>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">{formulario.id ? 'Editar template' : 'Novo template'}</h2>
                  <div className="grid grid-cols-1 2xl:grid-cols-2 gap-space-md">
                    <div className="flex flex-col gap-space-sm">
                      <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
                        Nome do template
                        <input value={formulario.nome} onChange={(e) => setFormulario({ ...formulario, nome: e.target.value })} aria-label="Nome do template" className="h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary" />
                        {erroDoCampo?.campo === 'nome' && <span role="alert" className="text-danger-text">{erroDoCampo.mensagem}</span>}
                      </label>
                      <label className="flex flex-col gap-1 font-label-md text-label-md text-text-secondary">
                        Mensagem
                        <textarea ref={campoDaMensagem} value={formulario.corpo} onChange={(e) => setFormulario({ ...formulario, corpo: e.target.value })} aria-label="Mensagem do template" rows={8} className="px-3 py-2 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary resize-y" />
                        <span className="flex items-center justify-between gap-2">
                          {erroDoCampo?.campo === 'corpo' ? <span role="alert" className="text-danger-text">{erroDoCampo.mensagem}</span> : <span />}
                          <span className={`font-body-sm text-body-sm ${formulario.corpo.length > CORPO_MAXIMO ? 'text-danger-text' : 'text-text-muted'}`}>
                            {formulario.corpo.length}/{CORPO_MAXIMO}
                          </span>
                        </span>
                      </label>

                      <div className="rounded-xl border border-border-subtle p-space-sm flex flex-col gap-2">
                        <p className="font-label-md text-label-md text-text-secondary">Shortcodes — clique para inserir onde está o cursor</p>
                        <div role="tablist" aria-label="Grupo de shortcodes" className="flex flex-wrap gap-1">
                          {GRUPOS.map((g) => (
                            <button
                              key={g}
                              type="button"
                              role="tab"
                              aria-selected={grupo === g}
                              onClick={() => setGrupo(g)}
                              className={`h-8 px-3 rounded-full font-label-md text-label-md flex items-center gap-1 ${grupo === g ? 'bg-primary text-on-primary font-semibold' : 'bg-surface-subtle text-text-secondary hover:bg-surface-container'}`}
                            >
                              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                                {ICONE_DO_GRUPO[g]}
                              </span>
                              {g}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {variaveisDoGrupo.map((v) => (
                            <button
                              key={v.chave}
                              type="button"
                              onClick={() => inserir(v.chave)}
                              onMouseEnter={() => setDica(v)}
                              onFocus={() => setDica(v)}
                              onMouseLeave={() => setDica(null)}
                              onBlur={() => setDica(null)}
                              aria-label={`Inserir {{${v.chave}}}`}
                              title={`${v.ajuda} Ex.: ${v.exemplo}`}
                              className="h-9 px-3 rounded-lg bg-info-surface text-primary font-mono text-[12px] hover:bg-surface-container"
                            >
                              {`{{${v.chave}}}`}
                            </button>
                          ))}
                        </div>
                        <p role="status" className="min-h-[2.5rem] font-body-sm text-body-sm text-text-muted">
                          {dica ? (
                            <>
                              <span className="text-text-secondary">{dica.ajuda}</span> Exemplo: <span className="text-text-primary break-all">{dica.exemplo}</span>
                            </>
                          ) : (
                            'Passe o mouse sobre um shortcode para ver o que ele vira. Sem o dado (ex.: card sem reunião), fica visível na conversa e sai vazio no lote.'
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="font-label-md text-label-md text-text-secondary">Prévia ao vivo</p>
                      <Balao corpo={formulario.corpo} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sticky bottom-0 bg-surface-card pt-2">
                    <Button type="button" disabled={trabalhando} onClick={() => void salvar()}>
                      Salvar template
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setFormulario(null)}>
                      Cancelar
                    </Button>
                  </div>
                </>
              )}

              {!formulario && escolhido && (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="font-headline-sm text-headline-sm text-text-primary">{escolhido.nome}</h2>
                    <span className={`px-2.5 py-1 rounded-full font-label-sm text-label-sm ${COR[escolhido.status]}`}>{ROTULO[escolhido.status]}</span>
                  </div>
                  <Balao corpo={escolhido.corpo} />
                  {escolhido.status === 'aprovado' && escolhido.aprovadoPorNome && <p className="font-body-sm text-body-sm text-text-muted">Aprovado por {escolhido.aprovadoPorNome}</p>}
                  {podeGerir && escolhido.status !== 'arquivado' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button type="button" disabled={trabalhando} onClick={() => abrirEditor({ id: escolhido.id, nome: escolhido.nome, corpo: escolhido.corpo })} aria-label={`Editar: ${escolhido.nome}`} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                        Editar
                      </button>
                      {escolhido.status === 'rascunho' && (
                        <button type="button" disabled={trabalhando} onClick={() => void enviar(`/api/whatsapp/templates/${escolhido.id}`, 'PATCH', { acao: 'aprovar' }, 'Template aprovado')} aria-label={`Aprovar: ${escolhido.nome}`} className="h-9 px-3 rounded-lg bg-success-surface font-label-md text-label-md font-semibold text-success-text">
                          Aprovar
                        </button>
                      )}
                      <button type="button" disabled={trabalhando} onClick={() => void enviar(`/api/whatsapp/templates/${escolhido.id}`, 'PATCH', { acao: 'arquivar' }, 'Template arquivado')} aria-label={`Arquivar: ${escolhido.nome}`} className="h-9 px-3 rounded-lg bg-surface-subtle font-label-md text-label-md font-semibold text-text-primary">
                        Arquivar
                      </button>
                    </div>
                  )}
                </>
              )}

              {!formulario && !escolhido && (
                <div className="py-12">
                  <EstadoVazio titulo="Escolha um template" proximoPasso={podeGerir ? 'clique em um da lista ou crie um em Novo template' : 'clique em um da lista para ver a prévia'} icone="article" />
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

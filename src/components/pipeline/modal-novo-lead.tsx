'use client';

// T-160 (fase4-pipeline-telas, US-106, AC-391/AC-392): modal "Novo Lead no
// Pipeline" — fonte visual `6._pipeline_funil_pipeline/code.html` (bloco
// `#modal-novo-card`). Campos obrigatórios: nome, telefone e origem
// (AC-391); responsável e valor são opcionais. Origem: valores existentes
// na empresa mais "Outro" com texto livre (ASM-137, decisão do usuário em
// 26/10 — sem lista oficial). Este componente só valida e monta o payload;
// quem chama a API (`POST /api/oportunidades`, T-165, e
// `POST /api/oportunidades/[id]/cadencia/iniciar` para "Salvar e Iniciar
// Cadência") é `BoardKanban`, via `onCriar`/`onCriarEIniciarCadencia` — mesmo
// desenho de `ModalDadoFaltante` (quem confirma o dado não decide a
// transição).
import { useState } from 'react';

export interface DadosNovoLead {
  nome: string;
  telefone: string;
  email?: string;
  origem: string;
  responsavelId?: string;
  valor?: string;
}

export interface ResultadoSalvarNovoLead {
  ok: boolean;
  /** Mensagem pronta para mostrar ao usuário quando `ok` é `false`. */
  erro?: string;
  /** Quando o erro é de um campo específico (AC-391), destaca esse campo. */
  campo?: 'nome' | 'telefone' | 'origem';
}

export interface OpcaoResponsavelNovoLead {
  id: string;
  nome: string;
}

interface ModalNovoLeadProps {
  aberto: boolean;
  origens: string[];
  responsaveis: OpcaoResponsavelNovoLead[];
  onFechar: () => void;
  /** "Criar Card na Entrada": só cria o card, sem cadência (AC-391). */
  onCriar: (dados: DadosNovoLead) => Promise<ResultadoSalvarNovoLead>;
  /** "Salvar e Iniciar Cadência": cria o card e já inicia a cadência (AC-392). */
  onCriarEIniciarCadencia: (dados: DadosNovoLead) => Promise<ResultadoSalvarNovoLead>;
}

const VALOR_OUTRO = '__outro__';

type ErrosCampo = Partial<Record<'nome' | 'telefone' | 'origem' | 'outraOrigem', string>>;

const CLASSE_CAMPO =
  'w-full h-10 px-3 bg-surface-subtle rounded-xl font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';

function estadoInicial() {
  return { nome: '', telefone: '', email: '', origem: '', outraOrigem: '', responsavelId: '', valor: '' };
}

/** AC-391: os três campos obrigatórios — "Outro" exige o texto da origem informada à parte. */
function validar(estado: ReturnType<typeof estadoInicial>): ErrosCampo {
  const erros: ErrosCampo = {};
  if (!estado.nome.trim()) erros.nome = 'Informe o nome da clínica ou médico.';
  if (!estado.telefone.trim()) erros.telefone = 'Informe o telefone.';
  if (!estado.origem) erros.origem = 'Selecione a origem do lead.';
  if (estado.origem === VALOR_OUTRO && !estado.outraOrigem.trim()) erros.outraOrigem = 'Informe a origem.';
  return erros;
}

function paraDados(estado: ReturnType<typeof estadoInicial>): DadosNovoLead {
  return {
    nome: estado.nome.trim(),
    telefone: estado.telefone.trim(),
    email: estado.email.trim() || undefined,
    origem: estado.origem === VALOR_OUTRO ? estado.outraOrigem.trim() : estado.origem,
    responsavelId: estado.responsavelId || undefined,
    valor: estado.valor.trim() || undefined,
  };
}

export function ModalNovoLead({
  aberto,
  origens,
  responsaveis,
  onFechar,
  onCriar,
  onCriarEIniciarCadencia,
}: ModalNovoLeadProps) {
  const [estado, setEstado] = useState(estadoInicial);
  const [erros, setErros] = useState<ErrosCampo>({});
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!aberto) return null;

  function mudar(patch: Partial<ReturnType<typeof estadoInicial>>) {
    setEstado((atual) => ({ ...atual, ...patch }));
  }

  function fechar() {
    setEstado(estadoInicial());
    setErros({});
    setErroEnvio(null);
    onFechar();
  }

  async function enviar(acao: (dados: DadosNovoLead) => Promise<ResultadoSalvarNovoLead>) {
    const encontrados = validar(estado);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    setEnviando(true);
    setErroEnvio(null);
    try {
      const resultado = await acao(paraDados(estado));
      if (resultado.ok) {
        fechar();
        return;
      }
      if (resultado.campo) {
        setErros((atual) => ({ ...atual, [resultado.campo as string]: resultado.erro }));
      } else {
        setErroEnvio(resultado.erro ?? 'Não foi possível salvar o lead. Tente de novo.');
      }
    } catch {
      setErroEnvio('Não foi possível salvar o lead. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface-card rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-space-lg py-space-md flex items-center justify-between">
          <div>
            <h2 className="font-headline-md text-headline-md text-text-primary leading-tight">Novo Lead no Pipeline</h2>
            <p className="font-body-sm text-body-sm text-text-secondary">
              Cadastre a clínica e dê início à régua de relacionamento.
            </p>
          </div>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="w-8 h-8 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-subtle flex items-center justify-center transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
              close
            </span>
          </button>
        </div>

        <div className="p-space-lg space-y-space-md">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="novo-lead-nome" className="font-label-md text-label-md font-semibold text-text-primary">
              Nome da Clínica / Médico <span className="text-danger-text">*</span>
            </label>
            <input
              id="novo-lead-nome"
              type="text"
              value={estado.nome}
              onChange={(evento) => mudar({ nome: evento.target.value })}
              placeholder="Ex: Clínica Oftalmo Alphaville"
              className={CLASSE_CAMPO}
            />
            {erros.nome && (
              <p role="alert" className="font-body-sm text-body-sm text-danger-text">
                {erros.nome}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="novo-lead-telefone" className="font-label-md text-label-md font-semibold text-text-primary">
                WhatsApp / Telefone <span className="text-danger-text">*</span>
              </label>
              <input
                id="novo-lead-telefone"
                type="tel"
                value={estado.telefone}
                onChange={(evento) => mudar({ telefone: evento.target.value })}
                placeholder="(11) 99999-9999"
                className={CLASSE_CAMPO}
              />
              {erros.telefone && (
                <p role="alert" className="font-body-sm text-body-sm text-danger-text">
                  {erros.telefone}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="novo-lead-email" className="font-label-md text-label-md font-semibold text-text-primary">
                E-mail Institucional
              </label>
              <input
                id="novo-lead-email"
                type="email"
                value={estado.email}
                onChange={(evento) => mudar({ email: evento.target.value })}
                placeholder="contato@clinica.com.br"
                className={CLASSE_CAMPO}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="novo-lead-origem" className="font-label-md text-label-md font-semibold text-text-primary">
                Origem do Lead <span className="text-danger-text">*</span>
              </label>
              <select
                id="novo-lead-origem"
                value={estado.origem}
                onChange={(evento) => mudar({ origem: evento.target.value })}
                className={CLASSE_CAMPO}
              >
                <option value="">Selecione...</option>
                {origens.map((origem) => (
                  <option key={origem} value={origem}>
                    {origem}
                  </option>
                ))}
                <option value={VALOR_OUTRO}>Outro</option>
              </select>
              {erros.origem && (
                <p role="alert" className="font-body-sm text-body-sm text-danger-text">
                  {erros.origem}
                </p>
              )}
              {estado.origem === VALOR_OUTRO && (
                <>
                  <input
                    id="novo-lead-outra-origem"
                    aria-label="Qual origem?"
                    type="text"
                    value={estado.outraOrigem}
                    onChange={(evento) => mudar({ outraOrigem: evento.target.value })}
                    placeholder="Qual origem?"
                    className={`${CLASSE_CAMPO} mt-1.5`}
                  />
                  {erros.outraOrigem && (
                    <p role="alert" className="font-body-sm text-body-sm text-danger-text">
                      {erros.outraOrigem}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="novo-lead-responsavel" className="font-label-md text-label-md font-semibold text-text-primary">
                Responsável Comercial
              </label>
              <select
                id="novo-lead-responsavel"
                value={estado.responsavelId}
                onChange={(evento) => mudar({ responsavelId: evento.target.value })}
                className={CLASSE_CAMPO}
              >
                <option value="">Sem responsável</option>
                {responsaveis.map((responsavel) => (
                  <option key={responsavel.id} value={responsavel.id}>
                    {responsavel.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="novo-lead-valor" className="font-label-md text-label-md font-semibold text-text-primary">
              Valor Estimado do Contrato (Mensal)
            </label>
            <input
              id="novo-lead-valor"
              type="text"
              value={estado.valor}
              onChange={(evento) => mudar({ valor: evento.target.value })}
              placeholder="6500.00"
              className={CLASSE_CAMPO}
            />
          </div>

          {erroEnvio && (
            <p role="alert" className="font-body-sm text-body-sm text-danger-text">
              {erroEnvio}
            </p>
          )}

          <div className="pt-space-sm flex items-center justify-end gap-space-sm">
            <button
              type="button"
              onClick={fechar}
              className="px-4 py-2 rounded-xl text-text-secondary hover:bg-surface-subtle font-label-md text-label-md font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => void enviar(onCriar)}
              className="px-4 py-2 rounded-xl bg-surface-subtle hover:bg-surface-container text-text-primary font-label-md text-label-md font-semibold transition-colors disabled:opacity-50"
            >
              Criar Card na Entrada
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => void enviar(onCriarEIniciarCadencia)}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md transition-all disabled:opacity-50"
            >
              Salvar e Iniciar Cadência
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

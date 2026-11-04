'use client';

// T-313 (fase4-pipeline, US-114): o modal "Fechamento de Clientes" — a mesma pergunta do CRM antigo ao fechar um cliente:
// plataforma anterior, o que deixou a desejar nela, o que mais interessou na MedGuia, plano, por onde conheceu e as observações.
// Todos os campos são obrigatórios. Serve para o fechamento (mover para "Contrato (Ganho)") e para a edição depois.
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  OPCAO_OUTRO,
  ORIGENS_DE_CONHECIMENTO,
  PLANOS,
  PLATAFORMAS_ANTERIORES,
  PONTOS_NEGATIVOS,
  type DadosFechamento,
} from '@/domain/pipeline/fechamento';

interface Props {
  /** `fechar`: o card vai para "Contrato (Ganho)" ao salvar; `editar`: só atualiza os dados. */
  modo: 'fechar' | 'editar';
  inicial?: Partial<DadosFechamento>;
  /** Valores que o sistema já sabe (plano da proposta e origem do lead) para vir marcados. */
  sugestoes?: { plano?: string | null; origem?: string | null };
  salvando?: boolean;
  erro?: string | null;
  onCancelar: () => void;
  onConfirmar: (dados: DadosFechamento) => void;
}

const CLASSE_CAMPO = 'w-full h-10 px-3 rounded-xl bg-surface-subtle border border-border-subtle font-body-md text-body-md text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60';

/** Divide o texto guardado em "opção da lista" + "texto livre" (quando não está na lista, é um "Outro"). */
function separar(valor: string | undefined, lista: string[]): { opcao: string; livre: string } {
  if (!valor) return { opcao: '', livre: '' };
  if (lista.includes(valor) && valor !== OPCAO_OUTRO) return { opcao: valor, livre: '' };
  return { opcao: OPCAO_OUTRO, livre: valor === OPCAO_OUTRO ? '' : valor };
}

function Rotulo({ children }: { children: string }) {
  return (
    <span className="font-label-md text-label-md text-text-primary">
      {children} <span className="text-danger-text">*</span>
    </span>
  );
}

export function ModalFechamento({ modo, inicial, sugestoes, salvando = false, erro, onCancelar, onConfirmar }: Props) {
  const plataforma = separar(inicial?.plataformaAnterior, PLATAFORMAS_ANTERIORES);
  const negativo = separar(inicial?.deixouADesejar, PONTOS_NEGATIVOS);
  const planoInicial = inicial?.plano ?? (sugestoes?.plano && PLANOS.includes(sugestoes.plano) ? sugestoes.plano : '');
  const origemInicial = inicial?.porOndeConheceu ?? (sugestoes?.origem && ORIGENS_DE_CONHECIMENTO.includes(sugestoes.origem) ? sugestoes.origem : '');

  const [plataformaOpcao, setPlataformaOpcao] = useState(plataforma.opcao);
  const [plataformaLivre, setPlataformaLivre] = useState(plataforma.livre);
  const [negativoOpcao, setNegativoOpcao] = useState(negativo.opcao);
  const [negativoLivre, setNegativoLivre] = useState(negativo.livre);
  const [maisInteressou, setMaisInteressou] = useState(inicial?.maisInteressou ?? '');
  const [plano, setPlano] = useState(planoInicial);
  const [origem, setOrigem] = useState(origemInicial);
  const [observacoes, setObservacoes] = useState(inicial?.observacoes ?? '');

  const plataformaFinal = plataformaOpcao === OPCAO_OUTRO ? plataformaLivre.trim() : plataformaOpcao;
  const negativoFinal = negativoOpcao === OPCAO_OUTRO ? negativoLivre.trim() : negativoOpcao;
  const completo = plataformaFinal !== '' && negativoFinal !== '' && maisInteressou.trim() !== '' && plano !== '' && origem !== '' && observacoes.trim() !== '';

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !salvando && onCancelar()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{modo === 'fechar' ? 'Fechamento de Clientes confirmado. Vamos registrar os detalhes?' : 'Dados do fechamento'}</DialogTitle>
          <DialogDescription>
            {modo === 'fechar'
              ? 'Esse card entrou na etapa de fechamento comercial. Preencha os dados para manter o histórico completo.'
              : 'Atualize os dados registrados no fechamento deste cliente.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-space-sm">
          <label className="flex flex-col gap-1">
            <Rotulo>Qual plataforma ele usava antes?</Rotulo>
            <select aria-label="Plataforma anterior" value={plataformaOpcao} onChange={(e) => setPlataformaOpcao(e.target.value)} disabled={salvando} className={CLASSE_CAMPO}>
              <option value="">Selecione a plataforma</option>
              {PLATAFORMAS_ANTERIORES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {plataformaOpcao === OPCAO_OUTRO && (
              <input aria-label="Qual plataforma" value={plataformaLivre} maxLength={200} onChange={(e) => setPlataformaLivre(e.target.value)} disabled={salvando} placeholder="Qual plataforma?" className={CLASSE_CAMPO} />
            )}
          </label>

          <label className="flex flex-col gap-1">
            <Rotulo>O que deixou a desejar na outra plataforma?</Rotulo>
            <select aria-label="O que deixou a desejar" value={negativoOpcao} onChange={(e) => setNegativoOpcao(e.target.value)} disabled={salvando} className={CLASSE_CAMPO}>
              <option value="">Selecione o motivo</option>
              {PONTOS_NEGATIVOS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {negativoOpcao === OPCAO_OUTRO && (
              <input aria-label="Qual o motivo" value={negativoLivre} maxLength={200} onChange={(e) => setNegativoLivre(e.target.value)} disabled={salvando} placeholder="Descreva o motivo" className={CLASSE_CAMPO} />
            )}
          </label>

          <label className="flex flex-col gap-1">
            <Rotulo>O que MAIS interessou ele na MedGuia?</Rotulo>
            <input aria-label="O que mais interessou" value={maisInteressou} maxLength={500} onChange={(e) => setMaisInteressou(e.target.value)} disabled={salvando} placeholder="Ex: Dashboard financeiro, agendamento online" className={CLASSE_CAMPO} />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
            <label className="flex flex-col gap-1">
              <Rotulo>Plano escolhido</Rotulo>
              <select aria-label="Plano escolhido" value={plano} onChange={(e) => setPlano(e.target.value)} disabled={salvando} className={CLASSE_CAMPO}>
                <option value="">Selecione o plano</option>
                {/* Um plano antigo, de texto livre da proposta, continua válido ao editar. */}
                {plano !== '' && !PLANOS.includes(plano) && <option value={plano}>{plano}</option>}
                {PLANOS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <Rotulo>Por onde conheceu?</Rotulo>
              <select aria-label="Por onde conheceu" value={origem} onChange={(e) => setOrigem(e.target.value)} disabled={salvando} className={CLASSE_CAMPO}>
                <option value="">Selecione a origem</option>
                {origem !== '' && !ORIGENS_DE_CONHECIMENTO.includes(origem) && <option value={origem}>{origem}</option>}
                {ORIGENS_DE_CONHECIMENTO.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <Rotulo>Observações gerais / combinados da reunião</Rotulo>
            <textarea
              aria-label="Observações gerais"
              value={observacoes}
              maxLength={2000}
              onChange={(e) => setObservacoes(e.target.value)}
              disabled={salvando}
              rows={4}
              placeholder="Acordos de pagamento, expectativas de migração de dados..."
              className="w-full p-3 rounded-xl bg-surface-subtle border border-border-subtle font-body-md text-body-md text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
          </label>

          {erro && (
            <p role="alert" className="font-body-sm text-body-sm text-danger-text bg-danger-surface rounded-lg px-3 py-2">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            disabled={!completo || salvando}
            onClick={() =>
              onConfirmar({ plataformaAnterior: plataformaFinal, deixouADesejar: negativoFinal, maisInteressou: maisInteressou.trim(), plano, porOndeConheceu: origem, observacoes: observacoes.trim() })
            }
          >
            {salvando ? 'Salvando...' : modo === 'fechar' ? 'Salvar Fechamento de Clientes' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O mesmo modal, já com o plano da proposta e a origem do lead do card como sugestão (busca antes de abrir; falha não impede). */
export function ModalFechamentoDoCard({ cardId, ...resto }: Omit<Props, 'sugestoes'> & { cardId: string }) {
  const [sugestoes, setSugestoes] = useState<{ plano: string | null; origem: string | null } | null>(null);

  useEffect(() => {
    let cancelado = false;
    const ler = async (url: string): Promise<Record<string, unknown> | null> => {
      try {
        const r = await fetch(url);
        return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    void Promise.all([ler(`/api/oportunidades/${cardId}/comercial`), ler(`/api/oportunidades/${cardId}`)]).then(([comercial, card]) => {
      if (cancelado) return;
      setSugestoes({ plano: typeof comercial?.plano === 'string' ? comercial.plano : null, origem: typeof card?.origem === 'string' ? card.origem : null });
    });
    return () => {
      cancelado = true;
    };
  }, [cardId]);

  if (!sugestoes) return null;
  return <ModalFechamento {...resto} sugestoes={sugestoes} />;
}

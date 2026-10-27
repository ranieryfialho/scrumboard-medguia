// T-160 (fase4-pipeline-telas, US-106, AC-389): os quatro cartões do topo do
// funil, a partir de `GET /api/pipeline/indicadores?visao=funil`
// (`obterIndicadoresFunil`, T-154/T-155 — já concluídas e com prova própria;
// aqui só a composição visual com `CartaoIndicador`, T-158). ASM-135: cards
// ativos (+ valor somado), toques em atraso, propostas ativas e conversão
// dos últimos 30 dias — nunca os números fixos do protótipo
// (`6._pipeline_funil_pipeline/code.html`: "+12%", "Meta 22%", "Ticket
// médio"), que não têm fonte no sistema.
import { CartaoIndicador } from './pecas/cartao-indicador';

export interface IndicadoresFunilView {
  cardsAtivos: { quantidade: number; valorTotal: string };
  toquesEmAtraso: number;
  propostasAtivas: number;
  conversao30Dias: { valor: number | null };
}

function formatarMoeda(valor: string): string {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return 'R$ 0';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarPercentual(valor: number | null): string {
  if (valor === null) return '—';
  return `${(valor * 100).toFixed(1)}%`;
}

export function IndicadoresFunil({ dados }: { dados: IndicadoresFunilView }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
      <CartaoIndicador
        titulo="Cards Ativos"
        valor={String(dados.cardsAtivos.quantidade)}
        legenda={formatarMoeda(dados.cardsAtivos.valorTotal)}
        icone="group_work"
        cor="primary"
      />
      <CartaoIndicador
        titulo="Toques em Atraso"
        valor={String(dados.toquesEmAtraso)}
        legenda="na fila de cadência"
        icone="notification_important"
        cor="warning"
      />
      <CartaoIndicador
        titulo="Propostas Ativas"
        valor={String(dados.propostasAtivas)}
        legenda="na etapa Proposta"
        icone="description"
        cor="info"
      />
      <CartaoIndicador
        titulo="Taxa de Conversão"
        valor={formatarPercentual(dados.conversao30Dias.valor)}
        legenda="últimos 30 dias"
        icone="trending_up"
        cor="success"
      />
    </div>
  );
}

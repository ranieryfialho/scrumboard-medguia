// T-225 (fase5-investimento-midia, AC-627 a AC-633): `GET ?mes=YYYY-MM` lista os canais do mês com o
// investimento de cada um; `PUT` grava ou remove valores. Ambos só para gerente+ (ASM-220).
import { NextResponse, type NextRequest } from 'next/server';

import { getDb } from '../../../db/client';
import { exigirGerente } from '../../../lib/equipe/acesso';
import { mesValido, normalizarCanal, valorValido } from '../../../lib/investimento/calculo';
import { dataLocalEmSaoPaulo } from '../../../domain/cadencia/turno';
import { gravarInvestimento, lerInvestimentoDoMes } from '../../../repositories/investimento';

export const dynamic = 'force-dynamic';

function mesAtual(): string {
  const l = dataLocalEmSaoPaulo(new Date());
  return `${l.ano}-${String(l.mes).padStart(2, '0')}`;
}
const recusa = (campo: string, mensagem: string) => NextResponse.json({ codigo: 'PARAMETRO_INVALIDO', campo, mensagem }, { status: 400 });

export async function GET(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;
  const mes = request.nextUrl.searchParams.get('mes') ?? mesAtual();
  if (!mesValido(mes)) return recusa('mes', 'Informe o mês como AAAA-MM.');
  return NextResponse.json(await lerInvestimentoDoMes(getDb(), acesso.contexto, mes));
}

export async function PUT(request: NextRequest) {
  const acesso = await exigirGerente(request);
  if ('resposta' in acesso) return acesso.resposta;

  const corpo = (await request.json().catch(() => null)) as { mes?: unknown; valores?: Record<string, unknown> } | null;
  if (!corpo || !mesValido(corpo.mes)) return recusa('mes', 'Informe o mês como AAAA-MM.');
  if (!corpo.valores || typeof corpo.valores !== 'object') return recusa('valores', 'Informe os valores.');

  const valores: Array<{ canal: string; valor: number | null }> = [];
  for (const [nome, valor] of Object.entries(corpo.valores)) {
    const canal = normalizarCanal(nome);
    if (!canal) return recusa(nome, 'O nome do canal deve ter de 2 a 60 caracteres.');
    if (valor !== null && !valorValido(valor)) return recusa(nome, 'O investimento deve ser um valor em reais de R$ 0,01 a R$ 9.999.999,99, com até duas casas.');
    valores.push({ canal, valor: valor as number | null });
  }
  await gravarInvestimento(getDb(), acesso.contexto, corpo.mes, valores);
  return NextResponse.json(await lerInvestimentoDoMes(getDb(), acesso.contexto, corpo.mes));
}

// T-204 (fase4-analises, US-133 a US-135): períodos prontos, formatação e tipos
// compartilhados pelas três telas de análises.
export type Preset = 'hoje' | '7dias' | '30dias' | 'mes' | 'trimestre';

export const ROTULO_DO_PRESET: Record<Preset, string> = {
  hoje: 'Hoje',
  '7dias': 'Últimos 7 dias',
  '30dias': 'Últimos 30 dias',
  mes: 'Este mês',
  trimestre: 'Trimestre atual',
};

const FUSO = 'America/Sao_Paulo';

function hojeEmSaoPaulo(agora: Date): { ano: number; mes: number; dia: number } {
  const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora).split('-').map(Number);
  return { ano, mes, dia };
}

function paraTexto(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ASM-192: `de`/`ate` (`YYYY-MM-DD`, inclusivos, em São Paulo) de cada período pronto. */
export function periodoDoPreset(preset: Preset, agora: Date = new Date()): { de: string; ate: string } {
  const { ano, mes, dia } = hojeEmSaoPaulo(agora);
  const hoje = new Date(Date.UTC(ano, mes - 1, dia));
  const diasAtras = (n: number) => new Date(Date.UTC(ano, mes - 1, dia - n));
  if (preset === 'hoje') return { de: paraTexto(hoje), ate: paraTexto(hoje) };
  if (preset === '7dias') return { de: paraTexto(diasAtras(6)), ate: paraTexto(hoje) };
  if (preset === '30dias') return { de: paraTexto(diasAtras(29)), ate: paraTexto(hoje) };
  if (preset === 'mes') return { de: paraTexto(new Date(Date.UTC(ano, mes - 1, 1))), ate: paraTexto(new Date(Date.UTC(ano, mes, 0))) };
  const primeiroMesDoTrimestre = Math.floor((mes - 1) / 3) * 3;
  return { de: paraTexto(new Date(Date.UTC(ano, primeiroMesDoTrimestre, 1))), ate: paraTexto(new Date(Date.UTC(ano, primeiroMesDoTrimestre + 3, 0))) };
}

/** Fração 0–1 → "68,4%"; `null` → "—". */
export function porcentagem(fracao: number | null | undefined): string {
  return fracao === null || fracao === undefined ? '—' : `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export function moeda(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : MOEDA.format(valor);
}

export function inteiro(valor: number): string {
  return valor.toLocaleString('pt-BR');
}

/** "2026-10-26" → "26/10". */
export function diaEMes(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter((p) => /[A-Za-zÀ-ú]/.test(p[0] ?? ''));
  return (partes.length ? partes : [nome]).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '#';
}

export interface Responsavel {
  id: string;
  nome: string;
}

function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** O período logo antes do escolhido, para a comparação: mês e trimestre voltam um mês/trimestre inteiro; os demais, o mesmo número de dias. */
export function periodoAnterior(preset: Preset, agora: Date = new Date()): { de: string; ate: string } {
  const { de, ate } = periodoDoPreset(preset, agora);
  if (preset === 'mes' || preset === 'trimestre') {
    const meses = preset === 'mes' ? 1 : 3;
    const [a, m] = de.split('-').map(Number);
    const novoDe = new Date(Date.UTC(a, m - 1 - meses, 1));
    const novoAte = new Date(Date.UTC(a, m - 1, 0));
    return { de: novoDe.toISOString().slice(0, 10), ate: novoAte.toISOString().slice(0, 10) };
  }
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;
  const novoAte = somarDias(de, -1);
  return { de: somarDias(novoAte, -(dias - 1)), ate: novoAte };
}

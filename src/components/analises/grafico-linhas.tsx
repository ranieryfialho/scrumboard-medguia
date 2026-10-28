// T-204 (fase4-analises, AC-565/AC-571): gráfico de linhas em SVG próprio (ASM-198), sem
// biblioteca. Eixo com valores, uma linha por série, legenda e uma tabela equivalente
// só para leitor de tela. Sem nenhum valor diferente de zero mostra "Sem dados no período".
export interface SerieDoGrafico {
  nome: string;
  /** Classe de cor do traço (token do tema), ex.: `stroke-primary`. */
  corTraco: string;
  /** Classe de cor do ponto da legenda, ex.: `bg-primary`. */
  corLegenda: string;
  valores: number[];
}

interface GraficoLinhasProps {
  titulo: string;
  rotulos: string[];
  series: SerieDoGrafico[];
  formatarValor?: (valor: number) => string;
}

const LARGURA = 640;
const ALTURA = 240;
const MARGEM = { topo: 16, direita: 16, base: 32, esquerda: 56 };

/** O maior valor "redondo" acima de `maximo`, para o eixo não terminar em número quebrado. */
function tetoDoEixo(maximo: number): number {
  if (maximo <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(maximo));
  return Math.ceil(maximo / potencia) * potencia;
}

export function GraficoLinhas({ titulo, rotulos, series, formatarValor = (v) => String(v) }: GraficoLinhasProps) {
  const maximo = Math.max(0, ...series.flatMap((s) => s.valores));
  if (rotulos.length === 0 || maximo === 0) {
    return <p className="font-body-md text-body-md text-text-secondary py-space-md">Sem dados no período</p>;
  }

  const teto = tetoDoEixo(maximo);
  const larguraUtil = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.base;
  const x = (i: number) => MARGEM.esquerda + (rotulos.length === 1 ? larguraUtil / 2 : (i / (rotulos.length - 1)) * larguraUtil);
  const y = (v: number) => MARGEM.topo + alturaUtil - (v / teto) * alturaUtil;
  const passo = Math.max(1, Math.ceil(rotulos.length / 7));
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * teto);

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex items-center gap-4 flex-wrap font-body-sm text-body-sm text-text-secondary">
        {series.map((s) => (
          <span key={s.nome} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full ${s.corLegenda}`} />
            {s.nome}
          </span>
        ))}
      </div>
      <svg role="img" aria-label={titulo} viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="w-full h-auto">
        {marcas.map((m) => (
          <g key={m}>
            <line x1={MARGEM.esquerda} x2={LARGURA - MARGEM.direita} y1={y(m)} y2={y(m)} className="stroke-surface-container" strokeWidth={1} />
            <text x={MARGEM.esquerda - 8} y={y(m) + 4} textAnchor="end" className="fill-text-muted" fontSize={11}>
              {formatarValor(m)}
            </text>
          </g>
        ))}
        {rotulos.map((r, i) =>
          i % passo === 0 || i === rotulos.length - 1 ? (
            <text key={`${r}-${i}`} x={x(i)} y={ALTURA - 10} textAnchor="middle" className="fill-text-muted" fontSize={11}>
              {r}
            </text>
          ) : null
        )}
        {series.map((s) => (
          <g key={s.nome}>
            <polyline fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className={s.corTraco} points={s.valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {s.valores.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} className={`${s.corTraco} fill-surface-card`} strokeWidth={2} />
            ))}
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th>Período</th>
            {series.map((s) => (
              <th key={s.nome}>{s.nome}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rotulos.map((r, i) => (
            <tr key={`${r}-${i}`}>
              <td>{r}</td>
              {series.map((s) => (
                <td key={s.nome}>{formatarValor(s.valores[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

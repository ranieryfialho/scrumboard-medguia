// fase6-qualificacao-comercial (US-199, AC-834/AC-835): o selo da faixa de qualificação, igual no funil, na lista e no bloco do card.
import { ROTULO_CURTO_DA_FAIXA, type FaixaDeQualificacao } from '@/domain/qualificacao/qualificacao';

export const COR_DA_FAIXA: Record<FaixaDeQualificacao, string> = {
  A: 'bg-success-surface text-success-text',
  B: 'bg-info-surface text-info-text',
  C: 'bg-warning-surface text-warning-text',
  baixo: 'bg-surface-container text-text-secondary',
  revisao: 'bg-danger-surface text-danger-text',
};

interface Props {
  faixa: FaixaDeQualificacao | null | undefined;
  score?: number | null;
  /** Compacto (funil): só "A · 85". Padrão (lista): "Faixa A · 85". */
  compacto?: boolean;
}

export function SeloQualificacao({ faixa, score, compacto }: Props) {
  if (!faixa) return null;
  const nome = compacto && (faixa === 'A' || faixa === 'B' || faixa === 'C') ? faixa : ROTULO_CURTO_DA_FAIXA[faixa];
  return (
    <span
      data-testid="selo-qualificacao"
      data-faixa={faixa}
      title={`Qualificação: ${ROTULO_CURTO_DA_FAIXA[faixa]}${score !== null && score !== undefined ? ` (${score}/100)` : ''}`}
      className={`font-label-sm text-[10px] uppercase font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1 shrink-0 ${COR_DA_FAIXA[faixa]}`}
    >
      {nome}
      {score !== null && score !== undefined && <span className="font-semibold">· {score}</span>}
    </span>
  );
}

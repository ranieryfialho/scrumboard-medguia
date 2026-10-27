// T-171 (fase4-card-abas, US-111, AC-419/AC-420): a barra de abas do card,
// num lugar só para as quatro telas (Resumo, Cadência, WhatsApp e Anexos).
// Fonte visual: a barra de abas de `10._pipeline_id_cadencia_cad_ncia_do_card/`.
import Link from 'next/link';

export type AbaDoCard = 'resumo' | 'cadencia' | 'whatsapp' | 'anexos';

/** `segmento` é o trecho depois de `/pipeline/[id]` (vazio no Resumo). Fonte única das rotas das abas (AC-419). */
export const ABAS_DO_CARD: ReadonlyArray<{ chave: AbaDoCard; rotulo: string; icone: string; segmento: string }> = [
  { chave: 'resumo', rotulo: 'Resumo', icone: 'dashboard', segmento: '' },
  { chave: 'cadencia', rotulo: 'Cadência', icone: 'checklist', segmento: 'cadencia' },
  { chave: 'whatsapp', rotulo: 'WhatsApp', icone: 'chat', segmento: 'conversa' },
  { chave: 'anexos', rotulo: 'Anexos & Evidências', icone: 'attachment', segmento: 'anexos' },
];

export function hrefDaAba(cardId: string, segmento: string): string {
  return segmento === '' ? `/pipeline/${cardId}` : `/pipeline/${cardId}/${segmento}`;
}

export interface ContagensDasAbas {
  /** Toques concluídos de 18 ("Cadência 2/18"); `null` enquanto não se sabe. */
  cadencia: { concluidos: number; total: number } | null;
  /** Total de anexos do card; `null` enquanto não se sabe. */
  anexos: number | null;
}

interface AbasDoCardProps {
  cardId: string;
  ativa: AbaDoCard;
  contagens?: ContagensDasAbas;
}

const CLASSE_BASE = 'flex items-center gap-2 px-4 py-2 rounded-lg font-label-lg text-label-lg whitespace-nowrap';

function Contador({ texto }: { texto: string }) {
  return (
    <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-[11px]">
      {texto}
    </span>
  );
}

function textoDoContador(chave: AbaDoCard, contagens?: ContagensDasAbas): string | null {
  if (!contagens) return null;
  if (chave === 'cadencia' && contagens.cadencia) return `${contagens.cadencia.concluidos}/${contagens.cadencia.total}`;
  if (chave === 'anexos' && contagens.anexos !== null) return String(contagens.anexos);
  return null;
}

export function AbasDoCard({ cardId, ativa, contagens }: AbasDoCardProps) {
  return (
    <nav
      aria-label="Abas do card"
      className="px-gutter pb-space-sm bg-surface-card shadow-sm flex items-center gap-1 overflow-x-auto"
    >
      {ABAS_DO_CARD.map((aba) => {
        const contador = textoDoContador(aba.chave, contagens);
        const conteudo = (
          <>
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              {aba.icone}
            </span>
            {aba.rotulo}
            {contador && <Contador texto={contador} />}
          </>
        );

        return aba.chave === ativa ? (
          <span key={aba.chave} aria-current="page" className={`${CLASSE_BASE} text-primary bg-primary-fixed/40`}>
            {conteudo}
          </span>
        ) : (
          <Link
            key={aba.chave}
            href={hrefDaAba(cardId, aba.segmento)}
            className={`${CLASSE_BASE} text-text-secondary hover:text-text-primary hover:bg-surface-subtle transition-colors`}
          >
            {conteudo}
          </Link>
        );
      })}
    </nav>
  );
}

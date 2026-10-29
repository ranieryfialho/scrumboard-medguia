'use client';

// T-262 (fase5-email-config, AC-700; antes só nos templates de WhatsApp, AC-673): a seção "Variáveis disponíveis" — cada
// shortcode, o que ele vira e um exemplo. Com `onInserir`, cada variável ganha o botão "Inserir" (colocar no cursor).
import { AJUDA_DAS_VARIAVEIS, VARIAVEIS_DO_TEMPLATE, renderizarTemplate } from '@/lib/whatsapp/template';

export const NOME_DE_EXEMPLO = 'Maria Souza';

interface Props {
  /** A frase de apoio embaixo do título (cada tela diz o que acontece com variável desconhecida). */
  observacao: string;
  onInserir?: (variavel: string) => void;
}

export function VariaveisDisponiveis({ observacao, onInserir }: Props) {
  return (
    <section aria-label="Variáveis disponíveis" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
      <h2 className="font-headline-sm text-headline-sm text-text-primary">Variáveis disponíveis</h2>
      <p className="font-body-sm text-body-sm text-text-muted">{observacao}</p>
      <ul className="flex flex-col gap-2">
        {VARIAVEIS_DO_TEMPLATE.map((v) => (
          <li key={v} className="rounded-xl bg-surface-subtle p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5 min-w-0">
              <code className="font-mono text-body-md text-primary">{`{{${v}}}`}</code>
              <span className="font-body-sm text-body-sm text-text-secondary">{AJUDA_DAS_VARIAVEIS[v]}</span>
              <span className="font-body-sm text-body-sm text-text-muted">
                Exemplo: para &quot;{NOME_DE_EXEMPLO}&quot; vira &quot;{renderizarTemplate(`{{${v}}}`, NOME_DE_EXEMPLO)}&quot;
              </span>
            </div>
            {onInserir && (
              <button type="button" onClick={() => onInserir(v)} aria-label={`Inserir {{${v}}}`} className="h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold">
                Inserir
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

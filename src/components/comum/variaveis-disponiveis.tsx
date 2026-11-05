'use client';

// T-262 (fase5-email-config, AC-700; antes só nos templates de WhatsApp, AC-673): a seção "Variáveis disponíveis" — cada
// shortcode, o que ele vira e um exemplo. Com `onInserir`, cada variável ganha o botão "Inserir" (colocar no cursor).
import { VARIAVEIS, CONTEXTO_DE_EXEMPLO, renderizarTemplate, type GrupoDaVariavel } from '@/lib/whatsapp/template';

export const NOME_DE_EXEMPLO = 'Maria Souza';

interface Props {
  /** A frase de apoio embaixo do título (cada tela diz o que acontece com variável desconhecida). */
  observacao: string;
  onInserir?: (variavel: string) => void;
  /** Só estas variáveis aparecem (o e-mail só troca `nome` e `primeiro_nome`); sem isso, o catálogo todo. */
  somente?: readonly string[];
}

export function VariaveisDisponiveis({ observacao, onInserir, somente }: Props) {
  const lista = somente ? VARIAVEIS.filter((v) => somente.includes(v.chave)) : VARIAVEIS;
  const grupos = [...new Set(lista.map((v) => v.grupo))] as GrupoDaVariavel[];
  return (
    <section aria-label="Variáveis disponíveis" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
      <h2 className="font-headline-sm text-headline-sm text-text-primary">Variáveis disponíveis</h2>
      <p className="font-body-sm text-body-sm text-text-muted">{observacao}</p>
      {grupos.map((grupo) => (
        <div key={grupo} className="flex flex-col gap-2">
          {grupos.length > 1 && <h3 className="font-label-md text-label-md text-text-secondary uppercase tracking-wider">{grupo}</h3>}
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {lista
              .filter((v) => v.grupo === grupo)
              .map((v) => (
                <li key={v.chave} className="rounded-xl bg-surface-subtle p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <code className="font-mono text-body-md text-primary">{`{{${v.chave}}}`}</code>
                    <span className="font-body-sm text-body-sm text-text-secondary">{v.ajuda}</span>
                    <span className="font-body-sm text-body-sm text-text-muted break-all">
                      Exemplo: vira &quot;{renderizarTemplate(`{{${v.chave}}}`, somente ? NOME_DE_EXEMPLO : CONTEXTO_DE_EXEMPLO)}&quot;
                    </span>
                  </div>
                  {onInserir && (
                    <button type="button" onClick={() => onInserir(v.chave)} aria-label={`Inserir {{${v.chave}}}`} className="h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-semibold">
                      Inserir
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

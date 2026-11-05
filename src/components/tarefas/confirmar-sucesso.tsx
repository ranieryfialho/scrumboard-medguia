'use client';

// Confirmação antes de "sucesso" num toque: o botão encerra a cadência, cancela os toques que faltam e leva o card a "Qualificando", e isso
// não se desfaz pela tela. Mandar a mensagem ou ligar NÃO é sucesso: só vale se o lead respondeu ou atendeu.
interface ConfirmarSucessoProps {
  /** Nome do lead (para a pessoa conferir que está no toque certo). */
  nome: string;
  trabalhando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarSucesso({ nome, trabalhando = false, onConfirmar, onCancelar }: ConfirmarSucessoProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirmar-sucesso-titulo">
      <div className="w-full max-w-md bg-surface-card rounded-2xl shadow-xl p-space-lg flex flex-col gap-space-md">
        <h2 id="confirmar-sucesso-titulo" className="font-headline-sm text-headline-sm text-text-primary">
          O lead respondeu?
        </h2>
        <p className="font-body-md text-body-md text-text-secondary">
          <strong className="text-text-primary">{nome}</strong> será marcado como alcançado. Isso <strong>encerra a cadência</strong>, cancela os toques que faltam e
          move o card para <strong>Qualificando</strong>.
        </p>
        <p className="font-body-sm text-body-sm text-text-muted">Se você só ligou ou mandou a mensagem e ele não respondeu, use “Não Atendeu”.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancelar} disabled={trabalhando} className="h-10 px-4 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary">
            Voltar
          </button>
          <button type="button" onClick={onConfirmar} disabled={trabalhando} className="h-10 px-4 rounded-xl bg-success-text text-white font-label-md text-label-md font-semibold disabled:opacity-60">
            Sim, o lead respondeu
          </button>
        </div>
      </div>
    </div>
  );
}

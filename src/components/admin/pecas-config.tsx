// Peças visuais compartilhadas pelas telas de configuração (Metas, E-mail, Google Meet): o mesmo cabeçalho de página, o mesmo cartão com
// título + ícone e o mesmo estilo de campo, para ficarem iguais ao resto do sistema (funil, campanhas, motivos de perda).
import type { ReactNode } from 'react';

/** Campo de texto padrão das configurações: fundo suave, foco com anel da cor primária. */
export const CLASSE_CAMPO =
  'h-11 w-full px-3 rounded-xl bg-surface-subtle border border-transparent font-body-md text-body-md text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:bg-surface-card focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

/** Aviso de resultado (sucesso ou erro) no mesmo formato em todas as telas. */
export function AvisoConfig({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={`flex items-start gap-2 font-body-md text-body-md rounded-xl px-3 py-2.5 ${ok ? 'text-success-text bg-success-surface' : 'text-danger-text bg-danger-surface'}`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[20px] shrink-0">
        {ok ? 'check_circle' : 'error'}
      </span>
      <span>{children}</span>
    </p>
  );
}

export function CabecalhoConfig({ titulo, descricao, acoes }: { titulo: string; descricao: string; acoes?: ReactNode }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-space-md">
      <div>
        <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">{titulo}</h1>
        <p className="font-body-md text-body-md text-text-secondary mt-0.5 max-w-2xl">{descricao}</p>
      </div>
      {acoes && <div className="flex items-center gap-space-sm flex-wrap">{acoes}</div>}
    </div>
  );
}

interface SecaoConfigProps {
  rotulo: string;
  titulo: string;
  icone: string;
  /** Nome da região para leitores de tela (e para os testes). */
  nome?: string;
  children: ReactNode;
  className?: string;
}

/** Cartão de uma seção: ícone, rótulo em maiúsculas e título, com o conteúdo embaixo. */
export function SecaoConfig({ rotulo, titulo, icone, nome, children, className = '' }: SecaoConfigProps) {
  return (
    <section aria-label={nome ?? titulo} className={`bg-surface-card rounded-2xl shadow-sm p-space-md flex flex-col gap-space-md ${className}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="w-10 h-10 rounded-xl bg-info-surface text-primary flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[22px]">{icone}</span>
        </span>
        <div className="flex flex-col">
          <span className="font-label-sm text-table-header uppercase text-text-muted tracking-wider">{rotulo}</span>
          <h2 className="font-headline-sm text-headline-sm text-text-primary">{titulo}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

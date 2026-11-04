// T-198 (fase4-campanhas, AC-545/AC-551): a prévia do e-mail em área isolada — `iframe`
// com `sandbox` vazio e `srcdoc`, então o HTML da campanha nunca executa script nem
// herda o estilo da página do CRM (ASM-186).
export type LarguraDaPrevia = 'desktop' | 'mobile';

/** `preencher`: a prévia ocupa a altura que sobrar no quadro onde está (telas de altura fixa), em vez dos 24rem de sempre. */
export function PreviaEmail({ assunto, corpoHtml, largura, preencher = false }: { assunto: string; corpoHtml: string; largura: LarguraDaPrevia; preencher?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 ${preencher ? 'flex-1 min-h-0' : ''}`}>
      <p className="font-body-sm text-body-sm text-text-muted">
        Assunto: <strong className="text-text-primary">{assunto.trim() || '(sem assunto)'}</strong>
      </p>
      <div className={`mx-auto w-full ${largura === 'mobile' ? 'max-w-[360px]' : ''} relative rounded-xl overflow-hidden bg-white shadow-sm ${preencher ? 'flex-1 min-h-[20rem]' : ''}`}>
        {corpoHtml.trim() === '' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-space-md text-center bg-surface-subtle/60 pointer-events-none">
            <span aria-hidden="true" className="material-symbols-outlined text-[36px] text-text-muted">mark_email_read</span>
            <p className="font-label-lg text-label-lg text-text-primary">Nada para mostrar ainda</p>
            <p className="font-body-sm text-body-sm text-text-muted max-w-xs">Escreva ou cole o HTML do e-mail, ou escolha um modelo. A prévia aparece aqui enquanto você digita.</p>
          </div>
        )}
        <iframe title="Prévia do e-mail" sandbox="" srcDoc={corpoHtml} className={`w-full border-0 ${preencher ? 'h-full' : 'h-96'}`} />
      </div>
    </div>
  );
}

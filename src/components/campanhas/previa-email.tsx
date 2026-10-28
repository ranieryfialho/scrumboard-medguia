// T-198 (fase4-campanhas, AC-545/AC-551): a prévia do e-mail em área isolada — `iframe`
// com `sandbox` vazio e `srcdoc`, então o HTML da campanha nunca executa script nem
// herda o estilo da página do CRM (ASM-186).
export type LarguraDaPrevia = 'desktop' | 'mobile';

export function PreviaEmail({ assunto, corpoHtml, largura }: { assunto: string; corpoHtml: string; largura: LarguraDaPrevia }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-body-sm text-body-sm text-text-muted">
        Assunto: <strong className="text-text-primary">{assunto.trim() || '(sem assunto)'}</strong>
      </p>
      <div className={`mx-auto w-full ${largura === 'mobile' ? 'max-w-[360px]' : ''} rounded-xl overflow-hidden bg-white shadow-sm`}>
        <iframe title="Prévia do e-mail" sandbox="" srcDoc={corpoHtml} className="w-full h-96 border-0" />
      </div>
    </div>
  );
}

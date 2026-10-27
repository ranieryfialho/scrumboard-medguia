// T-158 (fase4-pipeline-telas): selo de etapa por cor, reusado pelo funil,
// pela lista e pelo detalhe para marcar a etapa atual de um card (ASM-132:
// os nomes são sempre os do banco). Sem uma paleta oficial por etapa no
// protótipo, a cor é só visual — escolhida de forma determinística pelo
// nome, para a mesma etapa aparecer sempre com a mesma cor nas três telas.
const PALETA = [
  { fundo: 'bg-info-surface', texto: 'text-info-text', ponto: 'bg-info-text' },
  { fundo: 'bg-success-surface', texto: 'text-success-text', ponto: 'bg-success-text' },
  { fundo: 'bg-warning-surface', texto: 'text-warning-text', ponto: 'bg-warning-text' },
  { fundo: 'bg-secondary-fixed', texto: 'text-on-secondary-fixed', ponto: 'bg-primary' },
  { fundo: 'bg-surface-container', texto: 'text-text-secondary', ponto: 'bg-text-secondary' },
  { fundo: 'bg-danger-surface', texto: 'text-danger-text', ponto: 'bg-danger-text' },
];

function corPorNome(nome: string) {
  let hash = 0;
  for (let indice = 0; indice < nome.length; indice += 1) {
    hash = (hash * 31 + nome.charCodeAt(indice)) >>> 0;
  }
  return PALETA[hash % PALETA.length];
}

export function SeloEtapa({ nome }: { nome: string }) {
  const cor = corPorNome(nome);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-sm text-label-sm ${cor.fundo} ${cor.texto}`}
    >
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${cor.ponto}`} />
      {nome}
    </span>
  );
}

// Especialidade do lead (`leads.dados.especialidade`). O campo vem digitado do formulário do anúncio, então chega sujo (variações do
// mesmo termo, nome do médico, telefone, "Boa tarde"). Esta lista é o padrão: a tela de edição sugere estes nomes e
// `normalizarEspecialidade` junta as variações no nome padrão, para os relatórios e os filtros não se espalharem.

export const ESPECIALIDADES_PADRAO = [
  'Alergia e Imunologia',
  'Anestesiologia',
  'Cardiologia',
  'Cirurgia Geral',
  'Cirurgia Plástica',
  'Clínica Geral',
  'Cuidados Paliativos',
  'Dermatologia',
  'Endocrinologia',
  'Enfermagem',
  'Farmácia',
  'Fisioterapia',
  'Fonoaudiologia',
  'Gastroenterologia',
  'Geriatria',
  'Ginecologia e Obstetrícia',
  'Hematologia',
  'Medicina da Dor',
  'Medicina de Família e Comunidade',
  'Medicina do Esporte',
  'Neurologia',
  'Nutrição',
  'Nutrologia',
  'Odontologia',
  'Oftalmologia',
  'Ortopedia',
  'Otorrinolaringologia',
  'Pediatria',
  'Psicologia',
  'Psiquiatria',
  'Urologia',
  'Veterinária',
] as const;

export type EspecialidadePadrao = (typeof ESPECIALIDADES_PADRAO)[number];

// Cada regra reconhece o nome padrão por um trecho do texto (sem acento e em minúsculas). Vence a que aparece primeiro no texto: assim
// "Endocrinologista pediátrica" é Endocrinologia e "Fisioterapeuta dermatofuncional" é Fisioterapia.
const REGRAS: Array<[EspecialidadePadrao, RegExp]> = [
  ['Alergia e Imunologia', /alerg|imunolog/],
  ['Anestesiologia', /anestes/],
  ['Cardiologia', /cardio|\bcard\b/],
  ['Cirurgia Plástica', /cirurg\w* plastic|plastic/],
  ['Cirurgia Geral', /cirurg/],
  ['Clínica Geral', /clinic[oa]( geral| medic[oa])?\b|generalis|\bgeral\b|medicina geral/],
  ['Cuidados Paliativos', /paliativ/],
  ['Dermatologia', /dermat/],
  ['Endocrinologia', /endocrin/],
  ['Enfermagem', /enfermag|enfermeir/],
  ['Farmácia', /farmac/],
  ['Fisioterapia', /fisio/],
  ['Fonoaudiologia', /fono/],
  ['Gastroenterologia', /gastro/],
  ['Geriatria', /geriat/],
  ['Ginecologia e Obstetrícia', /ginec|obstet/],
  ['Hematologia', /hematolog/],
  ['Medicina da Dor', /\bdor\b/],
  ['Medicina de Família e Comunidade', /\bmfc\b|familia e comunidade/],
  ['Medicina do Esporte', /esporte/],
  ['Neurologia', /neuro/],
  ['Nutrologia', /nutrolog/],
  ['Nutrição', /nutric|nutricion/],
  ['Odontologia', /odont|dentist|implante/],
  ['Oftalmologia', /oftalm/],
  ['Ortopedia', /ortop|\bort\b/],
  ['Otorrinolaringologia', /otorrino|\boto\b/],
  ['Pediatria', /pediatr|\bped\b/],
  ['Psicologia', /psicolog/],
  ['Psiquiatria', /psiq/],
  ['Urologia', /urolog/],
  ['Veterinária', /veterin|\bvet\b/],
];

const SEM_ACENTO = /[̀-ͯ]/g;

/** Texto livre → nome padrão, ou `null` se não dá para reconhecer (nome de pessoa, telefone, "Boa tarde"...). Textos muito longos não são especialidade. */
export function normalizarEspecialidade(texto: string | null | undefined): EspecialidadePadrao | null {
  if (!texto) return null;
  const limpo = texto.normalize('NFD').replace(SEM_ACENTO, '').toLowerCase().trim();
  if (limpo.length < 2 || limpo.length > 60 || /^[\d\s.,()+-]+$/.test(limpo)) return null;
  let melhor: { nome: EspecialidadePadrao; posicao: number } | null = null;
  for (const [nome, regra] of REGRAS) {
    const achou = regra.exec(limpo);
    if (achou && (melhor === null || achou.index < melhor.posicao)) melhor = { nome, posicao: achou.index };
  }
  return melhor?.nome ?? null;
}

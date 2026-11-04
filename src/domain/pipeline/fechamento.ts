// T-313 (fase4-pipeline, US-114): o "Fechamento de Clientes" — as listas de opções, o formato dos dados e a validação.
// Funções puras, usadas pelo servidor (validar) e pela tela (montar o formulário). Só o que o CRM antigo já perguntava.
export interface DadosFechamento {
  plataformaAnterior: string;
  deixouADesejar: string;
  maisInteressou: string;
  plano: string;
  porOndeConheceu: string;
  observacoes: string;
}

export const OPCAO_OUTRO = 'Outro';

export const PLATAFORMAS_ANTERIORES = [
  'Nenhuma (primeiro sistema)',
  'Doctoralia (Marketplace e Clínicas)',
  'TuoTempo',
  'Gipo (antiga CRM Clinic)',
  'Feegow Clinic',
  'iClinic (Grupo Afya)',
  'ProDoctor',
  'HiDoctor',
  'Shosp',
  'MedPlus',
  'Clínica Ágil',
  'Amplimed',
  'Clinicorp',
  'Simples Dental',
  'Belle Software',
  'GestãoDS',
  'Memed',
  'Nabla',
  'Heidi Health',
  OPCAO_OUTRO,
];

export const PONTOS_NEGATIVOS = [
  'Preço alto / custo-benefício ruim',
  'Suporte lento ou ineficiente',
  'Interface complicada / difícil de usar',
  'Falta de funcionalidades essenciais',
  'Sistema lento ou instável',
  'Falta de integração com outros sistemas',
  'Sem módulo de telemedicina',
  'Sem prontuário eletrônico completo',
  'Sem gestão financeira integrada',
  'Sem agendamento online para pacientes',
  'Sem aplicativo mobile',
  'Contrato longo e difícil de cancelar',
  'Falta de personalização',
  'Treinamento insuficiente na implantação',
  'Relatórios e métricas limitados',
  'Não atendia clínicas com múltiplos profissionais',
  OPCAO_OUTRO,
];

export const PLANOS = ['Starter', 'Evolution IA', 'Premium IA'];
export const ORIGENS_DE_CONHECIMENTO = ['Instagram', 'Facebook', 'Landing Page', 'Indicação', 'Google', 'Evento', OPCAO_OUTRO];

export const LIMITES_DO_FECHAMENTO: Record<keyof DadosFechamento, number> = {
  plataformaAnterior: 200,
  deixouADesejar: 200,
  maisInteressou: 500,
  plano: 200,
  porOndeConheceu: 200,
  observacoes: 2000,
};

export const CAMPOS_DO_FECHAMENTO = Object.keys(LIMITES_DO_FECHAMENTO) as (keyof DadosFechamento)[];

/** Os seis campos, aparados e dentro do limite; `null` se algum faltar ou passar do tamanho. */
export function lerFechamento(corpo: unknown): DadosFechamento | null {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  const bruto = corpo as Record<string, unknown>;
  const lido: Partial<DadosFechamento> = {};
  for (const campo of CAMPOS_DO_FECHAMENTO) {
    const valor = bruto[campo];
    if (typeof valor !== 'string') return null;
    const texto = valor.trim();
    if (texto === '' || texto.length > LIMITES_DO_FECHAMENTO[campo]) return null;
    lido[campo] = texto;
  }
  return lido as DadosFechamento;
}

// Especialidade do lead: as variações do formulário viram o nome padrão; o que não é especialidade fica de fora.
import { describe, expect, test } from 'vitest';

import { ESPECIALIDADES_PADRAO, normalizarEspecialidade } from '../../src/domain/leads/especialidades';

describe('normalizarEspecialidade', () => {
  test.each([
    ['Fisioterapeuta', 'Fisioterapia'],
    ['Fisio', 'Fisioterapia'],
    ['Fisioterapia Domiciliar', 'Fisioterapia'],
    ['Fisioterapeuta dermatofuncional', 'Fisioterapia'],
    ['Ortopedista', 'Ortopedia'],
    ['Dr. Leonardo Ort Drumond', 'Ortopedia'],
    ['Clínico geral', 'Clínica Geral'],
    ['Clinica geral', 'Clínica Geral'],
    ['Clínica médica', 'Clínica Geral'],
    ['Clínico', 'Clínica Geral'],
    ['Generalista', 'Clínica Geral'],
    ['Generalisra', 'Clínica Geral'],
    ['MFC', 'Medicina de Família e Comunidade'],
    ['Dentista', 'Odontologia'],
    ['Implante', 'Odontologia'],
    ['Enfermeira', 'Enfermagem'],
    ['Farmacêutica Clínica', 'Farmácia'],
    ['Endocrinologista pediátrica', 'Endocrinologia'],
    ['Endócrino', 'Endocrinologia'],
    ['Ginecologista obstetra', 'Ginecologia e Obstetrícia'],
    ['Cirurgião plástico', 'Cirurgia Plástica'],
    ['Cirurgia geral', 'Cirurgia Geral'],
    ['Dr. Airton Ped', 'Pediatria'],
    ['Nutrologia', 'Nutrologia'],
    ['Nutrição', 'Nutrição'],
    ['Dor crônica', 'Medicina da Dor'],
    ['Vet', 'Veterinária'],
    ['Médica de família', 'Medicina de Família e Comunidade'],
    ['Medicina da família e da comunidade', 'Medicina de Família e Comunidade'],
    ['Mfc', 'Medicina de Família e Comunidade'],
    ['Saúde da familia', 'Medicina de Família e Comunidade'],
    ['Medicina integrativa', 'Medicina Integrativa'],
    ['Psiquiatria e medicina integrativa', 'Psiquiatria'],
    ['medicina intensiva', 'Medicina Intensiva'],
    ['Radiologista intervencionista', 'Radiologia'],
    ['Ultrassonografista', 'Radiologia'],
    ['Reumatologista', 'Reumatologia'],
    ['Vascular', 'Cirurgia Vascular'],
    ['Terapia Ocupacional', 'Terapia Ocupacional'],
    ['Psicanalista', 'Psicologia'],
    ['Psicofarmacologia', 'Psiquiatria'],
    ['Prótese Dentária', 'Odontologia'],
    ['Médica veterinária dermatologista', 'Veterinária'],
    ['Médica clínica', 'Clínica Geral'],
    ['Neurologia e geroatria', 'Neurologia'],
    ['Sou fisioterapeuta', 'Fisioterapia'],
  ])('"%s" vira "%s"', (entrada, esperado) => {
    expect(normalizarEspecialidade(entrada)).toBe(esperado);
  });

  test.each(['11976600177', 'Boa tarde', 'Pedreiro', 'Não tenho', 'financiamento', 'Massage Therapist', 'Recem formado', 'Medico', 'Dr. Aecio Aracati', '', null, undefined, 'x', '..', 'Eu faço tratamento que o ortopedista daqui de São Paulo vive me indicando muita coisa'])(
    '"%s" não é especialidade reconhecível',
    (entrada) => {
      expect(normalizarEspecialidade(entrada as string | null | undefined)).toBeNull();
    }
  );

  test('todo nome padrão é reconhecido por ele mesmo', () => {
    for (const nome of ESPECIALIDADES_PADRAO) expect(normalizarEspecialidade(nome)).toBe(nome);
  });
});

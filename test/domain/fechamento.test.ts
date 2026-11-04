// T-313 (fase4-pipeline, US-114): o formato do Fechamento de Clientes — seis campos, todos obrigatórios e dentro do tamanho.
import { describe, expect, test } from 'vitest';

import { LIMITES_DO_FECHAMENTO, lerFechamento, PLANOS, PLATAFORMAS_ANTERIORES, PONTOS_NEGATIVOS } from '../../src/domain/pipeline/fechamento';

const VALIDO = {
  plataformaAnterior: 'Feegow Clinic',
  deixouADesejar: 'Suporte lento ou ineficiente',
  maisInteressou: ' Agendamento online ',
  plano: 'Premium IA',
  porOndeConheceu: 'Instagram',
  observacoes: 'Pagamento em 12x.',
};

describe('T-313: fechamento de clientes', () => {
  test('aceita os seis campos e apara os espaços @spec:AC-781', () => {
    expect(lerFechamento(VALIDO)).toEqual({ ...VALIDO, maisInteressou: 'Agendamento online' });
  });

  test('recusa campo faltando, vazio, que não é texto ou acima do limite @spec:AC-782', () => {
    for (const campo of Object.keys(VALIDO)) {
      expect(lerFechamento({ ...VALIDO, [campo]: undefined })).toBeNull();
      expect(lerFechamento({ ...VALIDO, [campo]: '   ' })).toBeNull();
      expect(lerFechamento({ ...VALIDO, [campo]: 42 })).toBeNull();
    }
    expect(lerFechamento({ ...VALIDO, observacoes: 'a'.repeat(LIMITES_DO_FECHAMENTO.observacoes + 1) })).toBeNull();
    expect(lerFechamento(null)).toBeNull();
    expect(lerFechamento([])).toBeNull();
  });

  test('as listas do CRM antigo estão completas e terminam em "Outro" @spec:AC-783', () => {
    expect(PLANOS).toEqual(['Starter', 'Evolution IA', 'Premium IA']);
    expect(PLATAFORMAS_ANTERIORES.at(-1)).toBe('Outro');
    expect(PONTOS_NEGATIVOS.at(-1)).toBe('Outro');
    expect(PLATAFORMAS_ANTERIORES).toContain('Doctoralia (Marketplace e Clínicas)');
  });
});

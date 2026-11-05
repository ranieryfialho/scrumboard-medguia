// T-249 (fase5-whatsapp-lote-base): regras puras do lote — intervalo, limite, prévia e template.
import { describe, expect, test } from 'vitest';

import { LIMITE_POR_DISPARO, duracaoEstimadaSegundos, montarPrevia, sortearIntervaloSegundos } from '../../src/lib/whatsapp/lote-regras';
import { renderizarTemplate, validarTemplate, variaveisInvalidas } from '../../src/lib/whatsapp/template';

const lead = (n: number, extra: Partial<{ nome: string; telefone: string | null; consentimento: boolean }> = {}) => ({
  id: `id-${n}`,
  nome: `Lead ${n} Silva`,
  telefone: `55119999${String(n).padStart(5, '0')}`,
  consentimento: true,
  ...extra,
});

describe('T-249: regras do lote', () => {
  test('o intervalo sorteado nunca sai de 15 a 45 segundos e a duração usa a média @spec:AC-674', () => {
    for (const a of [0, 0.0001, 0.5, 0.9999, 0.99999999]) {
      const s = sortearIntervaloSegundos(() => a);
      expect(s).toBeGreaterThanOrEqual(15);
      expect(s).toBeLessThanOrEqual(45);
      expect(Number.isInteger(s)).toBe(true);
    }
    expect(sortearIntervaloSegundos(() => 0)).toBe(15);
    expect(sortearIntervaloSegundos(() => 0.999999)).toBe(45);
    expect(LIMITE_POR_DISPARO).toBe(50);
    expect(duracaoEstimadaSegundos(11)).toBe(300);
    expect(duracaoEstimadaSegundos(1)).toBe(0);
    expect(duracaoEstimadaSegundos(0)).toBe(0);
  });

  test('só entra quem tem telefone e consentimento, sem repetir número (nem pelo nono dígito), até o limite @spec:AC-675', () => {
    const leads = [
      lead(1),
      lead(2, { consentimento: false }),
      lead(3, { telefone: null }),
      lead(4, { telefone: '5511988880001' }),
      lead(5, { telefone: '551188880001' }), // mesmo número sem o nono dígito
      lead(6, { telefone: '(11) 97777-0002' }),
    ];
    const p = montarPrevia(['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-1', 'id-fantasma'], leads, 'Olá, {{primeiro_nome}}!');
    expect(p.elegiveis.map((e) => e.leadId)).toEqual(['id-1', 'id-4', 'id-6']);
    expect(p.elegiveis[0].mensagem).toBe('Olá, Lead!');
    expect(p.excluidos).toEqual([
      { leadId: 'id-2', nome: 'Lead 2 Silva', motivo: 'SEM_CONSENTIMENTO' },
      { leadId: 'id-3', nome: 'Lead 3 Silva', motivo: 'SEM_TELEFONE' },
      { leadId: 'id-5', nome: 'Lead 5 Silva', motivo: 'TELEFONE_REPETIDO' },
      { leadId: 'id-fantasma', nome: null, motivo: 'LEAD_NAO_ENCONTRADO' },
    ]);
    expect(p).toMatchObject({ limite: 50, intervalo: { minimoSegundos: 15, maximoSegundos: 45 }, duracaoEstimadaSegundos: 60 });

    const muitos = Array.from({ length: 53 }, (_, i) => lead(i + 100));
    const grande = montarPrevia(muitos.map((l) => l.id), muitos, 'Oi');
    expect(grande.elegiveis).toHaveLength(50);
    expect(grande.excluidos.map((e) => e.motivo)).toEqual(['ACIMA_DO_LIMITE', 'ACIMA_DO_LIMITE', 'ACIMA_DO_LIMITE']);
    expect(grande.elegiveis[49].leadId).toBe('id-149'); // a ordem enviada vale
  });

  test('o template só aceita {{nome}} e {{primeiro_nome}}, com tamanhos válidos, e preenche com o nome do lead @spec:AC-670', () => {
    expect(variaveisInvalidas('Oi {{nome}} e {{ primeiro_nome }}')).toEqual([]);
    expect(variaveisInvalidas('Oi {{cidade}} {{cidade}} {{}}')).toEqual(['cidade', '{{}}']);
    expect(renderizarTemplate('Olá, {{primeiro_nome}}! ({{nome}})', '  Maria  Souza ')).toBe('Olá, Maria! (Maria  Souza)');
    expect(validarTemplate({ nome: '  Boas   vindas ', corpo: ' Oi {{nome}} ' })).toEqual({ ok: true, nome: 'Boas vindas', corpo: 'Oi {{nome}}' });
    expect(validarTemplate({ nome: 'a', corpo: 'x' })).toMatchObject({ ok: false, campo: 'nome' });
    expect(validarTemplate({ nome: 'Ok', corpo: '' })).toMatchObject({ ok: false, campo: 'corpo' });
    expect(validarTemplate({ nome: 'Ok', corpo: 'x'.repeat(1001) })).toMatchObject({ ok: false, campo: 'corpo' });
    expect(validarTemplate({ nome: 'Ok', corpo: 'Oi {{cidade}}' })).toMatchObject({ ok: false, campo: 'corpo' });
  });
});

describe('shortcodes completos do template', () => {
  const agora = new Date('2026-11-05T15:00:00Z'); // 12h em Brasília

  test('troca lead, card, reunião e empresa pelo contexto; primeiro nomes e saudação são derivados', () => {
    const corpo = '{{saudacao}}, {{primeiro_nome}}! Reunião {{dia_semana_reuniao}} {{data_reuniao}} às {{hora_reuniao}}: {{link_meet}} — {{primeiro_nome_responsavel}} ({{empresa}}), {{valor}}, {{etapa}}, {{especialidade}}.';
    const texto = renderizarTemplate(
      corpo,
      { nome: 'Maria Souza', responsavel: 'Juliana Rocha', empresa: 'MedGuia', link_meet: 'https://meet.google.com/abc', data_reuniao: '12/11/2026', hora_reuniao: '14:30', dia_semana_reuniao: 'quinta-feira', valor: 'R$ 6.800,00', etapa: 'Reunião Agendada', especialidade: 'Cardiologia' },
      { agora }
    );
    expect(texto).toBe('Boa tarde, Maria! Reunião quinta-feira 12/11/2026 às 14:30: https://meet.google.com/abc — Juliana (MedGuia), R$ 6.800,00, Reunião Agendada, Cardiologia.');
  });

  test('variável sem dado sai vazia, ou fica visível com manterPendentes', () => {
    expect(renderizarTemplate('Link: {{link_meet}}', { nome: 'Ana' }, { agora })).toBe('Link: ');
    expect(renderizarTemplate('Link: {{link_meet}}', { nome: 'Ana' }, { agora, manterPendentes: true })).toBe('Link: {{link_meet}}');
  });

  test('o catálogo é aceito pela validação e variável fora dele continua recusada', () => {
    expect(variaveisInvalidas('{{link_meet}} {{hora_reuniao}} {{saudacao}} {{cidade}}')).toEqual(['cidade']);
  });
});

import { describe, expect, it } from 'vitest';

import { esperaUtilMs, urgenciaDoLead } from '../../../src/domain/pipeline/lead-novo';

const H = 60 * 60 * 1000;

describe('selo Novo — urgência por espera', () => {
  it('segunda a sexta: verde <4h, amarelo <24h, vermelho depois', () => {
    const criado = new Date('2026-11-10T13:00:00Z'); // terça 10h em Brasília
    expect(urgenciaDoLead(criado, new Date(criado.getTime() + 3 * H))).toBe('recente');
    expect(urgenciaDoLead(criado, new Date(criado.getTime() + 5 * H))).toBe('atencao');
    expect(urgenciaDoLead(criado, new Date(criado.getTime() + 25 * H))).toBe('parado');
  });

  it('não conta sábado e domingo na espera', () => {
    const sexta = new Date('2026-11-13T21:00:00Z'); // sexta 18h em Brasília
    const segunda = new Date('2026-11-16T12:00:00Z'); // segunda 09h
    expect(esperaUtilMs(sexta, segunda)).toBeLessThan(10 * H);
    expect(urgenciaDoLead(sexta, segunda)).toBe('atencao');
  });

  it('data ausente, inválida ou futura não mostra selo', () => {
    const agora = new Date('2026-11-10T13:00:00Z');
    expect(urgenciaDoLead(null, agora)).toBeNull();
    expect(urgenciaDoLead('lixo', agora)).toBeNull();
    expect(urgenciaDoLead(new Date(agora.getTime() + H), agora)).toBeNull();
  });
});

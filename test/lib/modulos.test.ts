// T-322 (fase4-admin, US-138): os módulos liberados de cada colaborador — o papel é o teto, os módulos só restringem; valem para o
// menu e para as páginas (as APIs seguem só as regras de papel).
import { describe, expect, test } from 'vitest';

import { menuParaPapel } from '../../src/components/shell/menu-config';
import { lerModulos, modulosDoPapel, modulosEfetivos, modulosPadraoDoPapel, moduloDaRota, MODULOS, PERFIS_PRONTOS } from '../../src/lib/auth/modulos';
import { podeAcessarRota } from '../../src/lib/auth/rotas';

describe('T-322: módulos liberados', () => {
  test('o papel define o teto: atendente alcança 5 módulos (Campanhas só se liberarem), gerente e master os 9 @spec:AC-771', () => {
    expect(modulosDoPapel('ATENDENTE')).toEqual(['pipeline', 'tarefas', 'agenda', 'whatsapp', 'campanhas']);
    // por padrão o atendente não tem Campanhas; gerente e master têm tudo
    expect(modulosPadraoDoPapel('ATENDENTE')).toEqual(['pipeline', 'tarefas', 'agenda', 'whatsapp']);
    expect(modulosPadraoDoPapel('GERENTE')).toHaveLength(MODULOS.length);
    expect(modulosDoPapel('GERENTE')).toHaveLength(MODULOS.length);
    expect(modulosDoPapel('MASTER')).toHaveLength(MODULOS.length);
  });

  test('sem módulos gravados vale o padrão do papel; gravados só restringem dentro do teto; master e super admin têm tudo @spec:AC-772', () => {
    expect([...modulosEfetivos('ATENDENTE', false, null)]).toEqual(modulosPadraoDoPapel('ATENDENTE'));
    // o atendente passa a ter Campanhas quando o master ou o gerente marca; sem marcar, nunca
    expect([...modulosEfetivos('ATENDENTE', false, ['pipeline', 'campanhas'])]).toEqual(['pipeline', 'campanhas']);
    expect(modulosEfetivos('ATENDENTE', false, null).has('campanhas')).toBe(false);
    expect([...modulosEfetivos('GERENTE', false, ['pipeline'])]).toEqual(['pipeline']);
    // um módulo acima do papel nunca é concedido por estar marcado
    expect([...modulosEfetivos('ATENDENTE', false, ['pipeline', 'indicadores'])]).toEqual(['pipeline']);
    expect(modulosEfetivos('MASTER', false, ['pipeline']).size).toBe(MODULOS.length);
    expect(modulosEfetivos('ATENDENTE', true, ['pipeline']).size).toBe(MODULOS.length);
  });

  test('cada página pertence ao módulo do prefixo mais específico @spec:AC-773', () => {
    expect(moduloDaRota('/pipeline')?.id).toBe('pipeline');
    expect(moduloDaRota('/pipeline/lista')?.id).toBe('pipeline');
    expect(moduloDaRota('/relatorios')?.id).toBe('relatorios');
    expect(moduloDaRota('/relatorios-comerciais')?.id).toBe('comercial');
    expect(moduloDaRota('/configuracoes/metas')?.id).toBe('administracao');
    expect(moduloDaRota('/equipe/convidar')?.id).toBe('administracao');
    expect(moduloDaRota('/login')).toBeUndefined();
    expect(moduloDaRota('/sem-acesso')).toBeUndefined();
  });

  test('lerModulos aceita só ids do teto do papel, sem repetir e ao menos um; null volta ao padrão @spec:AC-774', () => {
    expect(lerModulos(null, 'ATENDENTE')).toBeNull();
    expect(lerModulos(['pipeline', 'agenda', 'pipeline'], 'ATENDENTE')).toEqual(['pipeline', 'agenda']);
    expect(lerModulos(['indicadores'], 'ATENDENTE')).toBeUndefined();
    expect(lerModulos(['inexistente'], 'GERENTE')).toBeUndefined();
    expect(lerModulos([], 'GERENTE')).toBeUndefined();
    expect(lerModulos('pipeline', 'GERENTE')).toBeUndefined();
    expect(lerModulos(['indicadores'], 'GERENTE')).toEqual(['indicadores']);
  });

  test('as páginas respeitam os módulos; as APIs e o super admin não @spec:AC-775', () => {
    const restrito = { papel: 'ATENDENTE' as const, isSuperAdmin: false, modulos: ['pipeline'] };
    expect(podeAcessarRota(restrito, '/pipeline')).toBe(true);
    expect(podeAcessarRota(restrito, '/pipeline/lista')).toBe(true);
    expect(podeAcessarRota(restrito, '/whatsapp')).toBe(false);
    expect(podeAcessarRota(restrito, '/tarefas')).toBe(false);
    expect(podeAcessarRota(restrito, '/api/whatsapp/send')).toBe(true);
    expect(podeAcessarRota({ ...restrito, isSuperAdmin: true }, '/whatsapp')).toBe(true);
    // sem módulos gravados, nada muda
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false }, '/whatsapp')).toBe(true);
    // e o papel continua sendo o teto
    expect(podeAcessarRota({ papel: 'ATENDENTE', isSuperAdmin: false, modulos: ['pipeline'] }, '/equipe')).toBe(false);
  });

  test('o menu mostra só os itens dos módulos liberados e esconde os grupos vazios @spec:AC-776', () => {
    const itens = menuParaPapel('ATENDENTE', false, ['agenda']).flatMap((g) => g.itens.map((i) => i.id));
    expect(itens).toEqual(['agenda']);
    expect(menuParaPapel('ATENDENTE', false, ['agenda']).map((g) => g.titulo)).toEqual(['Operação']);
    // sem módulos, o menu é o do padrão do papel: o atendente não vê Campanhas, o gerente vê
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens).length).toBeGreaterThan(5);
    expect(menuParaPapel('ATENDENTE', false).flatMap((g) => g.itens.map((i) => i.id))).not.toContain('campanhas');
    expect(menuParaPapel('ATENDENTE', false, ['pipeline', 'campanhas']).flatMap((g) => g.itens.map((i) => i.id))).toContain('campanhas');
    expect(menuParaPapel('GERENTE', false).flatMap((g) => g.itens.map((i) => i.id))).toContain('campanhas');
    // super admin ignora os módulos
    expect(menuParaPapel('MASTER', true, ['agenda']).flatMap((g) => g.itens).length).toBeGreaterThan(10);
  });

  test('os perfis prontos do CRM antigo cabem no teto do papel @spec:AC-777', () => {
    for (const perfil of PERFIS_PRONTOS) {
      const teto = modulosDoPapel(perfil.papel);
      expect(perfil.modulos.every((m) => teto.includes(m))).toBe(true);
    }
  });
});

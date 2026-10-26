// Testes de T-141 (fase4-design-system-shell-acesso, US-105): política de
// senha única (Q-041), módulo puro compartilhado pelo servidor e pelas
// telas de convite e de redefinição.
import { describe, expect, test } from 'vitest';

import {
  avaliarSenha,
  CRITERIOS_SENHA,
  ErroSenhaFraca,
  senhaAtendePolitica,
  validarSenha,
} from '../../src/lib/auth/politica-senha';

describe('T-141: política de senha única', () => {
  describe('AC-385: o servidor recusa senha fora da política', () => {
    test('senha com menos de 8 caracteres é recusada @spec:AC-385', () => {
      expect(() => validarSenha('Ab1')).toThrow(ErroSenhaFraca);
      try {
        validarSenha('Ab1');
        throw new Error('deveria ter lançado ErroSenhaFraca');
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroSenhaFraca);
        const erroSenha = erro as ErroSenhaFraca;
        expect(erroSenha.codigo).toBe('SENHA_FRACA');
        expect(erroSenha.criteriosNaoAtendidos).toContain('comprimentoMinimo');
      }
    });

    test('senha sem letra maiúscula é recusada @spec:AC-385', () => {
      try {
        validarSenha('senha123');
        throw new Error('deveria ter lançado ErroSenhaFraca');
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroSenhaFraca);
        expect((erro as ErroSenhaFraca).criteriosNaoAtendidos).toEqual(['letraMaiuscula']);
      }
    });

    test('senha sem número nem símbolo é recusada @spec:AC-385', () => {
      try {
        validarSenha('SenhaForte');
        throw new Error('deveria ter lançado ErroSenhaFraca');
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroSenhaFraca);
        expect((erro as ErroSenhaFraca).criteriosNaoAtendidos).toEqual(['numeroOuSimbolo']);
      }
    });

    test('senha fraca em vários critérios lista todos os não atendidos @spec:AC-385', () => {
      try {
        validarSenha('abc');
        throw new Error('deveria ter lançado ErroSenhaFraca');
      } catch (erro) {
        expect(erro).toBeInstanceOf(ErroSenhaFraca);
        expect((erro as ErroSenhaFraca).criteriosNaoAtendidos).toEqual([
          'comprimentoMinimo',
          'letraMaiuscula',
          'numeroOuSimbolo',
        ]);
      }
    });

    test('senha que atende aos três critérios é aceita, com símbolo ou com número @spec:AC-385', () => {
      expect(() => validarSenha('Senha1234')).not.toThrow();
      expect(() => validarSenha('Senha#forte')).not.toThrow();
      expect(senhaAtendePolitica('Senha1234')).toBe(true);
      expect(senhaAtendePolitica('Senha#forte')).toBe(true);
    });
  });

  describe('AC-386: as duas telas mostram exatamente as regras que o servidor aplica', () => {
    test('avaliarSenha e validarSenha usam o mesmo módulo de política e concordam @spec:AC-386', () => {
      const amostras = [
        'curta1A',
        'semmaiuscula1',
        'SEMNUMEROOUSIMBOLO',
        'Senha1234',
        'Senha#forte',
        '',
        'A1!aaaaa',
      ];

      for (const senha of amostras) {
        const avaliacao = avaliarSenha(senha);
        const todosAtendidos = avaliacao.every((criterio) => criterio.atendido);

        expect(senhaAtendePolitica(senha)).toBe(todosAtendidos);

        if (todosAtendidos) {
          expect(() => validarSenha(senha)).not.toThrow();
        } else {
          try {
            validarSenha(senha);
            throw new Error('deveria ter lançado ErroSenhaFraca');
          } catch (erro) {
            expect(erro).toBeInstanceOf(ErroSenhaFraca);
            const esperados = avaliacao.filter((c) => !c.atendido).map((c) => c.id);
            expect((erro as ErroSenhaFraca).criteriosNaoAtendidos).toEqual(esperados);
          }
        }
      }
    });

    test('a lista de critérios exibível pelas telas é a mesma usada para avaliar @spec:AC-386', () => {
      expect(avaliarSenha('qualquer').map((c) => c.id)).toEqual(CRITERIOS_SENHA.map((c) => c.id));
      expect(avaliarSenha('qualquer').map((c) => c.descricao)).toEqual(
        CRITERIOS_SENHA.map((c) => c.descricao)
      );
    });
  });
});

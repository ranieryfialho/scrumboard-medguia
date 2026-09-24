// Testes de T-033 (fase1-auth-rbac, US-020): rate limit de login, convite e
// reset. Não depende de Postgres — o limitador é em memória de processo — e
// simula a linha do tempo via `agora()` injetado, nos mesmos moldes das
// opções `agora`/`gerarToken` usadas em reset-senha.ts (T-030).
import { describe, expect, test } from 'vitest';

import {
  chavePorEmail,
  chavePorIp,
  ErroLimiteTaxaExcedido,
  JANELA_PADRAO_MS,
  LimitadorTaxa,
  registrarFalha,
  registrarSucesso,
  verificarLimite,
} from '../../src/lib/auth/rate-limit';

describe('T-033: rate limit de login, convite e reset', () => {
  describe('AC-047: excesso de tentativas de login bloqueia temporariamente', () => {
    test('até o limite de falhas, a verificação permanece liberada @spec:AC-047', () => {
      const limitador = new LimitadorTaxa({ limite: 5, janelaMs: JANELA_PADRAO_MS });
      const chave = chavePorEmail('login', 'usuario@teste.com');

      for (let i = 0; i < 4; i++) {
        expect(() => limitador.verificar(chave)).not.toThrow();
        limitador.registrarFalha(chave);
      }

      expect(() => limitador.verificar(chave)).not.toThrow();
    });

    test('acima do limite de falhas, para o mesmo e-mail, a próxima tentativa é recusada mesmo com credenciais corretas @spec:AC-047', () => {
      let agoraMs = Date.parse('2026-01-01T00:00:00.000Z');
      const limitador = new LimitadorTaxa({ limite: 5, janelaMs: JANELA_PADRAO_MS, agora: () => new Date(agoraMs) });
      const chave = chavePorEmail('login', 'usuario@teste.com');

      for (let i = 0; i < 5; i++) {
        limitador.verificar(chave);
        limitador.registrarFalha(chave);
        agoraMs += 1_000;
      }

      // Simula uma nova tentativa dentro da janela com credenciais corretas:
      // quem chama deve verificar o limite ANTES de validar a credencial, e
      // aqui a verificação já deve recusar por conta das 5 falhas anteriores.
      expect(() => limitador.verificar(chave)).toThrow(ErroLimiteTaxaExcedido);
    });

    test('acima do limite de falhas, para o mesmo IP, a próxima tentativa é recusada mesmo com e-mails diferentes @spec:AC-047', () => {
      const limitador = new LimitadorTaxa({ limite: 3, janelaMs: JANELA_PADRAO_MS });
      const ip = '203.0.113.10';

      for (let i = 0; i < 3; i++) {
        const chaveIp = chavePorIp('login', ip);
        limitador.verificar(chaveIp);
        limitador.registrarFalha(chaveIp);
      }

      expect(() => limitador.verificar(chavePorIp('login', ip))).toThrow(ErroLimiteTaxaExcedido);
    });

    test('verificarLimite recusa se o e-mail OU o IP já excederam o limite @spec:AC-047', () => {
      const limitador = new LimitadorTaxa({ limite: 2, janelaMs: JANELA_PADRAO_MS });
      const email = 'vitima@teste.com';
      const ipAtacante = '198.51.100.7';

      // Duas falhas vindas de IPs diferentes, mesmo e-mail-alvo: o limite
      // por e-mail estoura primeiro, mesmo com o IP da terceira tentativa
      // sendo novo.
      registrarFalha(limitador, 'login', email, '198.51.100.1');
      registrarFalha(limitador, 'login', email, '198.51.100.2');

      expect(() => verificarLimite(limitador, 'login', email, ipAtacante)).toThrow(
        ErroLimiteTaxaExcedido
      );
    });

    test('passada a janela de tempo, a tentativa volta a ser liberada @spec:AC-047', () => {
      let agoraMs = Date.parse('2026-01-01T00:00:00.000Z');
      const janelaMs = 60_000;
      const limitador = new LimitadorTaxa({ limite: 2, janelaMs, agora: () => new Date(agoraMs) });
      const chave = chavePorEmail('login', 'usuario@teste.com');

      limitador.registrarFalha(chave);
      limitador.registrarFalha(chave);
      expect(() => limitador.verificar(chave)).toThrow(ErroLimiteTaxaExcedido);

      agoraMs += janelaMs + 1;

      expect(() => limitador.verificar(chave)).not.toThrow();
    });

    test('operações diferentes (login/convite/reset) têm limites independentes para o mesmo e-mail @spec:AC-047', () => {
      const limitador = new LimitadorTaxa({ limite: 1, janelaMs: JANELA_PADRAO_MS });
      const email = 'usuario@teste.com';
      const ip = '203.0.113.20';

      registrarFalha(limitador, 'login', email, ip);

      expect(() => verificarLimite(limitador, 'login', email, ip)).toThrow(ErroLimiteTaxaExcedido);
      expect(() => verificarLimite(limitador, 'convite', email, ip)).not.toThrow();
      expect(() => verificarLimite(limitador, 'reset', email, ip)).not.toThrow();
    });

    test('registrarSucesso limpa o histórico de falhas da chave @spec:AC-047', () => {
      const limitador = new LimitadorTaxa({ limite: 2, janelaMs: JANELA_PADRAO_MS });
      const email = 'usuario@teste.com';
      const ip = '203.0.113.30';

      registrarFalha(limitador, 'login', email, ip);
      registrarFalha(limitador, 'login', email, ip);
      expect(() => verificarLimite(limitador, 'login', email, ip)).toThrow(ErroLimiteTaxaExcedido);

      registrarSucesso(limitador, 'login', email, ip);

      expect(() => verificarLimite(limitador, 'login', email, ip)).not.toThrow();
    });
  });
});

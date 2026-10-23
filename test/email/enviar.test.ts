// Testes de T-142 (fase4-design-system-shell-acesso, US-100): envio de
// e-mail (Resend) para redefinição de senha, com transporte falso (sem
// rede).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  criarTransporteResend,
  enviarEmailRedefinicaoSenha,
  ErroRemetenteNaoConfigurado,
  type EmailParaEnviar,
} from '../../src/lib/email/enviar';

class TransporteFalso {
  enviados: EmailParaEnviar[] = [];

  async enviar(email: EmailParaEnviar): Promise<void> {
    this.enviados.push(email);
  }
}

describe('T-142: envio de e-mail (Resend) para redefinição de senha', () => {
  describe('AC-365: o e-mail só é enviado quando a conta existe', () => {
    test('com token (conta cadastrada e ativa), envia o e-mail marcado MedCRM com o link do token @spec:AC-365', async () => {
      const transporte = new TransporteFalso();

      const resultado = await enviarEmailRedefinicaoSenha('dra.juliana@saolucas.med.br', 'tok123', {
        transporte,
        baseUrl: 'https://app.medguia.cloud',
      });

      expect(resultado).toEqual({ enviado: true });
      expect(transporte.enviados).toHaveLength(1);

      const [email] = transporte.enviados;
      expect(email.destinatario).toBe('dra.juliana@saolucas.med.br');
      expect(email.assunto).toContain('MedCRM');
      expect(email.html).toContain('/redefinir-senha/tok123');
      expect(email.texto).toContain('/redefinir-senha/tok123');
    });

    test('sem token (e-mail inexistente ou usuário inativo), nenhum e-mail é enviado @spec:AC-365', async () => {
      const transporte = new TransporteFalso();

      const resultado = await enviarEmailRedefinicaoSenha('ninguem@exemplo.com', null, { transporte });

      expect(resultado).toEqual({ enviado: false });
      expect(transporte.enviados).toHaveLength(0);
    });
  });

  describe('transporte Resend (sem rede, só o comportamento de configuração)', () => {
    const fetchOriginal = global.fetch;

    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = fetchOriginal;
      vi.restoreAllMocks();
    });

    test('falha com erro claro quando RESEND_API_KEY falta no momento do envio', async () => {
      const transporte = criarTransporteResend({ apiKey: undefined });

      await expect(
        transporte.enviar({ destinatario: 'a@b.com', assunto: 'x', html: 'x', texto: 'x' })
      ).rejects.toThrow(ErroRemetenteNaoConfigurado);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('com a chave configurada, chama a API do Resend com o remetente e o destinatário', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });

      const transporte = criarTransporteResend({ apiKey: 'chave-teste', remetente: 'no-reply@medguia.cloud' });
      await transporte.enviar({
        destinatario: 'dra.juliana@saolucas.med.br',
        assunto: 'MedCRM — Redefinição de senha',
        html: '<p>x</p>',
        texto: 'x',
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const corpo = JSON.parse((init as RequestInit).body as string);
      expect(corpo.from).toBe('no-reply@medguia.cloud');
      expect(corpo.to).toEqual(['dra.juliana@saolucas.med.br']);
    });
  });
});

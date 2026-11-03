// T-302 (fase4-tarefas-agenda, AC-765): o endereço pelo qual a pessoa acessou o CRM, usado como endereço de retorno do Google.
import { describe, expect, test } from 'vitest';

import { origemDaRequisicao } from '../../src/lib/google/origem';

const url = (texto: string) => new URL(texto);
const cabecalhos = (campos: Record<string, string>) => new Headers(campos);

describe('T-302: origem da requisição para o retorno do Google', () => {
  test('atrás do proxy vale o endereço encaminhado, não o interno do container @spec:AC-765', () => {
    const h = cabecalhos({ 'x-forwarded-host': 'staging-crm.medguia.cloud', 'x-forwarded-proto': 'https', host: 'crm-app-staging:3000' });
    expect(origemDaRequisicao(h, url('http://localhost:3000/api/integracoes/google/conectar'))).toBe('https://staging-crm.medguia.cloud');
  });

  test('com vários valores encaminhados vale o primeiro (o do cliente) @spec:AC-765', () => {
    const h = cabecalhos({ 'x-forwarded-host': 'crm.medguia.cloud, interno:3000', 'x-forwarded-proto': 'https, http' });
    expect(origemDaRequisicao(h, url('http://localhost:3000/x'))).toBe('https://crm.medguia.cloud');
  });

  test('sem cabeçalhos encaminhados vale o host do pedido, com o protocolo do pedido @spec:AC-765', () => {
    expect(origemDaRequisicao(cabecalhos({ host: 'localhost:3000' }), url('http://localhost:3000/x'))).toBe('http://localhost:3000');
    expect(origemDaRequisicao(cabecalhos({}), url('https://crm.medguia.cloud/x'))).toBe('https://crm.medguia.cloud');
  });

  test('protocolo desconhecido volta para o do pedido, e host com lixo volta para a origem do pedido @spec:AC-765', () => {
    expect(origemDaRequisicao(cabecalhos({ 'x-forwarded-host': 'a.b.c', 'x-forwarded-proto': 'javascript' }), url('http://localhost:3000/x'))).toBe('http://a.b.c');
    for (const ruim of ['evil.com/caminho', 'a b', 'a@b.com', '//x', 'x?y=1', '']) {
      expect(origemDaRequisicao(cabecalhos({ 'x-forwarded-host': ruim }), url('https://crm.medguia.cloud/x')), ruim).toBe('https://crm.medguia.cloud');
    }
  });
});

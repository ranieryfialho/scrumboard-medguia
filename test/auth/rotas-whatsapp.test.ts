// T-195 (fase4-whatsapp, US-128): os itens de WhatsApp do menu apontam para
// páginas que existem (hoje "WhatsApp Inbox" levava a um 404), a casca marca o
// item certo e as quatro rotas exigem sessão. Sem banco: matriz de rotas e menu
// como funções puras.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { ehRotaPublica, podeAcessarRota } from '../../src/lib/auth/rotas';
import { encontrarItemAtivo, menuParaPapel } from '../../src/components/shell/menu-config';
import type { PapelUsuario } from '../../src/lib/auth/convites';

const RAIZ = join(__dirname, '..', '..');
const PAPEIS: PapelUsuario[] = ['ATENDENTE', 'GERENTE', 'MASTER'];
const ITENS = [
  { href: '/whatsapp', rotulo: 'WhatsApp Inbox', pagina: 'src/app/(app)/whatsapp/page.tsx' },
  { href: '/whatsapp/conexao', rotulo: 'Conexão & QR Code', pagina: 'src/app/(app)/whatsapp/conexao/page.tsx' },
  { href: '/whatsapp/configuracao', rotulo: 'Configuração Evolution', pagina: 'src/app/(app)/whatsapp/configuracao/page.tsx' },
];

describe('T-195: menu, rotas e páginas de WhatsApp', () => {
  test('o grupo Comunicação tem os três itens de WhatsApp e cada um tem a sua página, para os três papéis @spec:AC-530', () => {
    for (const papel of PAPEIS) {
      const comunicacao = menuParaPapel(papel, false).find((g) => g.titulo === 'Comunicação');
      expect(comunicacao).toBeTruthy();
      for (const { href, rotulo, pagina } of ITENS) {
        const item = comunicacao!.itens.find((i) => i.href === href);
        expect(item?.rotulo, `${papel} precisa ver "${rotulo}"`).toBe(rotulo);
        expect(existsSync(join(RAIZ, pagina)), `${href} precisa da página ${pagina}`).toBe(true);
      }
      expect(comunicacao!.itens.find((i) => i.href === '/whatsapp')?.contador).toBe('whatsappNaoLidas');
    }
    expect(existsSync(join(RAIZ, 'src/app/(app)/whatsapp/nova/page.tsx'))).toBe(true);
  });

  test('a casca marca o item certo em cada rota, inclusive /whatsapp/nova em "WhatsApp Inbox", e as rotas exigem sessão @spec:AC-530', () => {
    const esperado: Array<[string, string]> = [
      ['/whatsapp', '/whatsapp'],
      ['/whatsapp/nova', '/whatsapp'],
      ['/whatsapp/conexao', '/whatsapp/conexao'],
      ['/whatsapp/configuracao', '/whatsapp/configuracao'],
    ];
    for (const papel of PAPEIS) {
      for (const [caminho, itemAtivo] of esperado) {
        expect(ehRotaPublica(caminho)).toBe(false);
        expect(podeAcessarRota({ papel, isSuperAdmin: false }, caminho)).toBe(true);
        expect(encontrarItemAtivo(menuParaPapel(papel, false), caminho)?.href).toBe(itemAtivo);
      }
    }
  });
});

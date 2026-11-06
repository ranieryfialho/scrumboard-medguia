// @vitest-environment jsdom
//
// A foto do contato na caixa de entrada: mostra a imagem do CRM e, se ela não existe (contato sem foto ou foto oculta), cai nas iniciais.
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AvatarContato } from '../../../src/components/whatsapp/avatar-contato';

afterEach(cleanup);

describe('AvatarContato', () => {
  test('pede a foto ao CRM pelo número do contato', () => {
    const { container } = render(<AvatarContato numero="5585999985587" nome="Raniery Fialho" className="w-10" />);
    const imagem = container.querySelector('img')!;
    expect(imagem.getAttribute('src')).toBe('/api/whatsapp/foto?numero=5585999985587');
    expect(imagem.getAttribute('loading')).toBe('lazy');
    expect(screen.queryByText('RF')).toBeNull();
  });

  test('por lead (card do funil): pede a foto pelo leadId e cai nas iniciais se não houver', () => {
    const { container } = render(<AvatarContato leadId="lead-1" nome="Raniery Fialho" className="size-8" />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/whatsapp/foto?leadId=lead-1');
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('RF')).toBeTruthy();
  });

  test('sem foto (a imagem dá erro): mostra as iniciais', () => {
    const { container } = render(<AvatarContato numero="5585999985587" nome="Raniery Fialho" className="w-10" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('RF')).toBeTruthy();
  });

  test('sem número: já mostra as iniciais, sem pedir foto', () => {
    const { container } = render(<AvatarContato numero="" nome="Clínica Moura" className="w-10" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('CM')).toBeTruthy();
  });

  test('trocar de contato tenta a foto do novo, mesmo se o anterior não tinha', () => {
    const { container, rerender } = render(<AvatarContato numero="5585000000001" nome="Sem Foto" className="w-10" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<AvatarContato numero="5585000000002" nome="Com Foto" className="w-10" />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/whatsapp/foto?numero=5585000000002');
  });
});

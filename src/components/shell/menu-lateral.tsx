'use client';

// T-146 (fase4-design-system-shell-acesso, US-098): menu lateral da casca —
// grupos/itens e filtro por papel vêm de `menu-config.ts` (AC-348/AC-349),
// o item ativo de `encontrarItemAtivo` contra `usePathname()` (AC-350), os
// selos de contagem de `useContadores` (AC-351) e "Ajuda & Suporte" fica
// visível porém inerte, com o selo "em breve" (AC-355: sem link, sem
// `onClick`, nada acontece ao clicar). Fiel ao `<aside>` do protótipo
// (`13._tarefas_fila_do_turno_atual/code.html`): mesmas classes de cor e o
// `v<versão>` do rodapé, agora a versão real de `package.json` (Q-042).
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import packageJson from '../../../package.json';
import type { PapelUsuario } from '@/lib/auth/convites';

import { encontrarItemAtivo, menuParaPapel, type ItemMenu } from './menu-config';
import { useContadores } from './use-contadores';

export interface MenuLateralProps {
  papel: PapelUsuario;
  isSuperAdmin: boolean;
  /** AC-356: controla a gaveta no celular — fechada por padrão (desktop ignora). */
  gavetaAberta?: boolean;
  aoFecharGaveta?: () => void;
}

const CLASSES_ITEM_INATIVO =
  'text-text-muted hover:bg-sidebar-surface-active/70 hover:text-surface-container-lowest';
const CLASSES_ITEM_ATIVO = 'bg-sidebar-surface-active text-surface-container-lowest font-semibold';

const CLASSES_CONTADOR: Record<NonNullable<ItemMenu['contador']>, string> = {
  tarefasDoTurno: 'bg-primary-container text-on-primary',
  tarefasAtrasadas: 'bg-danger-surface text-danger-text',
  whatsappNaoLidas: 'bg-success-surface text-success-text',
};

export function MenuLateral({ papel, isSuperAdmin, gavetaAberta = false, aoFecharGaveta }: MenuLateralProps) {
  const pathname = usePathname();
  const grupos = menuParaPapel(papel, isSuperAdmin);
  const itemAtivo = encontrarItemAtivo(grupos, pathname ?? '');
  const contadores = useContadores();

  return (
    <>
      {/* AC-356: fundo escurecido da gaveta no celular — fecha ao tocar fora do menu. */}
      {gavetaAberta && (
        <div
          data-testid="gaveta-backdrop"
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={aoFecharGaveta}
        />
      )}
      <aside
        className={`fixed left-0 top-0 h-full w-64 bg-sidebar-surface text-surface z-50 flex flex-col justify-between shadow-[0_4px_20px_-2px_rgba(0,0,0,0.08)] overflow-hidden transition-transform duration-200 ${
          gavetaAberta ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex flex-col flex-1 min-h-0">
          <div className="h-16 px-space-lg flex items-center gap-space-sm border-b border-sidebar-surface-active/60 bg-sidebar-surface">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-md">
              <span aria-hidden="true" className="material-symbols-outlined text-on-primary text-[20px]">
                local_hospital
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-surface-container-lowest leading-none tracking-tight">
                MedCRM
              </span>
              <span className="font-label-sm text-label-sm text-text-muted mt-0.5">MedGuia B2B</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-space-sm py-space-md space-y-space-lg">
            <nav className="space-y-space-md">
              {grupos.map((grupo) => (
                <div key={grupo.titulo} className="space-y-1">
                  <div className="px-space-sm pb-1">
                    <span className="font-table-header text-table-header text-text-muted uppercase tracking-wider">
                      {grupo.titulo}
                    </span>
                  </div>
                  {grupo.itens.map((item) => {
                    const ativo = item.id === itemAtivo?.id;
                    const contador = item.contador ? contadores[item.contador] : undefined;
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        data-path={item.id}
                        onClick={aoFecharGaveta}
                        className={`flex items-center justify-between px-space-sm py-2 rounded-lg transition-colors ${
                          ativo ? CLASSES_ITEM_ATIVO : CLASSES_ITEM_INATIVO
                        }`}
                      >
                        <div className="flex items-center gap-space-sm">
                          <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
                            {item.icone}
                          </span>
                          <span className="font-body-md text-body-md">{item.rotulo}</span>
                        </div>
                        {contador !== undefined && item.contador && (
                          <span
                            className={`font-label-sm text-label-sm px-2 py-0.5 rounded-full font-bold ${CLASSES_CONTADOR[item.contador]}`}
                          >
                            {contador}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
        <div className="p-space-md border-t border-sidebar-surface-active/50 bg-sidebar-surface">
          <div className="flex items-center justify-between text-text-muted">
            {/* AC-355: visível, sem link e sem onClick — clicar não leva a lugar nenhum. */}
            <span className="flex items-center gap-2 font-label-md text-label-md cursor-not-allowed">
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                help
              </span>
              <span>Ajuda &amp; Suporte</span>
              <span className="font-label-sm text-[9px] px-1.5 py-0.5 rounded bg-sidebar-surface-active/80 uppercase tracking-wider">
                Em breve
              </span>
            </span>
            <span className="font-label-sm text-label-sm text-text-muted/80 bg-sidebar-surface-active/80 px-2 py-0.5 rounded">
              v{packageJson.version}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

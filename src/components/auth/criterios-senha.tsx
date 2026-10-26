'use client';

// T-147 (fase4-design-system-shell-acesso, US-101/US-102): lista de
// critérios de senha que acende enquanto o usuário digita (AC-367),
// compartilhada pelas telas de redefinir senha (T-150) e de convite
// (T-151). Usa `avaliarSenha` de `politica-senha.ts` (T-141) para que a
// tela nunca divirja do que o servidor aplica (AC-386) — nenhuma regra
// própria aqui.
import { avaliarSenha } from '@/lib/auth/politica-senha';

export interface CriteriosSenhaProps {
  senha: string;
}

export function CriteriosSenha({ senha }: CriteriosSenhaProps) {
  const criterios = avaliarSenha(senha);

  return (
    <ul className="space-y-1.5">
      {criterios.map((criterio) => (
        <li
          key={criterio.id}
          className="flex items-center gap-2 font-body-sm text-body-sm"
          data-atendido={criterio.atendido}
        >
          <span
            className={
              criterio.atendido
                ? 'material-symbols-outlined text-base text-success-text'
                : 'material-symbols-outlined text-base text-text-muted'
            }
            style={criterio.atendido ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            {criterio.atendido ? 'check_circle' : 'radio_button_unchecked'}
          </span>
          <span className={criterio.atendido ? 'text-text-primary' : 'text-text-secondary'}>
            {criterio.descricao}
          </span>
        </li>
      ))}
    </ul>
  );
}

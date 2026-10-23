// T-147 (fase4-design-system-shell-acesso, US-099/US-100/US-101/US-102/US-103):
// moldura comum das cinco telas de acesso — fundo com os três círculos
// desfocados, o cartão `max-w-[460px] rounded-2xl` e o rodapé institucional,
// como em `1._login_acesso_plataforma/code.html`. Sem o seletor de estado
// ("Estado: Padrão/Carregando/Erro/Bloqueado") nem os selos de certificação
// do protótipo (HIPAA, ISO 27001, "SSL 256-bit"): o rodapé mostra só
// afirmações verdadeiras — "Conexão segura", a versão real do
// `package.json` e "© 2026 MedGuia" — decidido em Q-042 (AC-347).
import packageJson from '../../../package.json';

export interface MolduraAcessoProps {
  children: React.ReactNode;
}

export function MolduraAcesso({ children }: MolduraAcessoProps) {
  return (
    <div className="flex flex-col w-full min-h-screen justify-center items-center py-10 px-4 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-36 -right-28 w-96 h-96 rounded-full bg-secondary-container/60 blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-surface-tint/5 blur-2xl pointer-events-none" />

      <div className="w-full max-w-[460px] bg-surface-card rounded-2xl shadow-xl p-8 md:p-10 z-10 relative">
        {children}
      </div>

      <div className="w-full max-w-[460px] text-center mt-6 z-10">
        <p className="font-label-sm text-label-sm text-text-muted">Conexão segura</p>
        <p className="font-label-sm text-label-sm text-text-muted">
          MedCRM v{packageJson.version} · © 2026 MedGuia
        </p>
      </div>
    </div>
  );
}

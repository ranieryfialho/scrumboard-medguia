// T-163 (fase4-pipeline-telas, US-109, AC-407): bloco "Informações
// Principais" do detalhe — só os dados que o sistema tem. Decisão do
// usuário (26/10): os blocos do protótipo sem dado no sistema somem, não
// ficam "em breve" — por isso este componente não recebe (e não desenha)
// CNPJ, estrutura da clínica, valor anual, unidade física, telefone extra
// nem e-mail extra do protótipo; só o que existe de fato em `leads`/
// `oportunidades`/`lead_telefones`.
export interface TelefoneInformacao {
  numero: string;
  principal: boolean;
}

interface InformacoesProps {
  valor: string | null;
  origem: string | null;
  /** `oportunidade.criadoEm` (ISO) — data de entrada do card no pipeline. */
  criadoEm: string;
  responsavelNome: string | null;
  proximaAcaoEm: string | null;
  telefones: TelefoneInformacao[];
  email: string | null;
}

function formatarMoeda(valor: string | null): string | null {
  if (!valor) return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function haNDias(iso: string): string {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

/** AC-407: mostra valor estimado, origem, data de entrada, responsável, próxima ação, telefones e e-mail — nada além disso. */
export function Informacoes({ valor, origem, criadoEm, responsavelNome, proximaAcaoEm, telefones, email }: InformacoesProps) {
  const valorFormatado = formatarMoeda(valor);
  const proximaAcaoVencida = proximaAcaoEm ? new Date(proximaAcaoEm).getTime() < Date.now() : false;

  return (
    <div className="bg-surface-card rounded-xl p-space-lg shadow-sm flex flex-col gap-space-md">
      <div className="flex items-center justify-between pb-space-sm border-b border-border-subtle">
        <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-primary text-[20px]">
            badge
          </span>
          Informações Principais
        </h2>
      </div>

      <div className="bg-surface-subtle p-space-md rounded-lg flex items-center justify-between">
        <div>
          <span className="font-label-sm text-text-muted block uppercase tracking-wider">Valor Estimado</span>
          <span className="font-metric-stat text-metric-stat text-text-primary font-bold">
            {valorFormatado ?? '—'}
            {valorFormatado && <span className="text-headline-sm font-normal text-text-muted">/mês</span>}
          </span>
        </div>
        <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary">
          <span aria-hidden="true" className="material-symbols-outlined text-[22px]">
            payments
          </span>
        </div>
      </div>

      <div className="space-y-3 font-body-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-text-muted">
              share_location
            </span>
            Origem do Lead
          </span>
          <span className="font-label-md text-text-primary font-semibold bg-surface-subtle px-2 py-0.5 rounded">
            {origem ?? '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary flex items-center gap-1.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[17px] text-text-muted">
              calendar_today
            </span>
            Data de Entrada
          </span>
          <span className="font-label-md text-text-primary">
            {formatarData(criadoEm)} <span className="text-text-muted">({haNDias(criadoEm)})</span>
          </span>
        </div>
      </div>

      <div className="pt-3 border-t border-border-subtle">
        <span className="font-label-sm text-text-muted block uppercase tracking-wider mb-2">Responsável Comercial</span>
        <p className="font-label-lg text-text-primary font-semibold">{responsavelNome ?? 'Sem responsável'}</p>
      </div>

      <div
        className={
          proximaAcaoVencida
            ? 'p-3 rounded-lg bg-danger-surface/40 flex flex-col gap-1.5 shadow-sm'
            : 'p-3 rounded-lg bg-surface-subtle flex flex-col gap-1.5 shadow-sm'
        }
      >
        <div className="flex items-center justify-between">
          <span
            className={
              proximaAcaoVencida
                ? 'font-label-sm font-bold uppercase tracking-wider text-danger-text'
                : 'font-label-sm font-bold uppercase tracking-wider text-text-secondary'
            }
          >
            Próxima Ação
          </span>
          {proximaAcaoEm && proximaAcaoVencida && (
            <span className="font-label-sm px-1.5 py-0.2 rounded bg-danger-surface font-bold text-danger-text text-[10px]">
              Vencida
            </span>
          )}
        </div>
        <p className="font-body-sm text-text-primary font-medium">
          {proximaAcaoEm ? formatarDataHora(proximaAcaoEm) : 'Nenhuma próxima ação agendada'}
        </p>
      </div>

      {telefones.length > 0 && (
        <div className="pt-2 border-t border-border-subtle space-y-2">
          <span className="font-label-sm text-text-muted block uppercase tracking-wider">Telefones</span>
          {telefones.map((telefone) => (
            <div key={telefone.numero} className="flex items-center justify-between font-body-sm">
              <span className="flex items-center gap-2 text-text-primary font-mono text-xs">
                <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[17px]">
                  {telefone.principal ? 'phone_iphone' : 'call'}
                </span>
                {telefone.numero}
              </span>
              {telefone.principal && (
                <span className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[10px] font-bold">
                  Principal
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {email && (
        <div className="pt-2 border-t border-border-subtle flex items-center gap-2 font-body-sm">
          <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[18px]">
            mail
          </span>
          <span className="text-text-secondary">E-mail:</span>
          <span className="font-label-md text-text-primary">{email}</span>
        </div>
      )}
    </div>
  );
}

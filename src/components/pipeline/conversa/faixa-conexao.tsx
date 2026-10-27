// T-174 (fase4-card-abas, US-114, AC-441): a faixa de conexão do WhatsApp no topo
// da conversa — "Conectada • nome da instância" ou o aviso de desconectada /
// não configurada, com o link para a configuração.
import Link from 'next/link';

export interface StatusDoWhatsapp {
  state: string;
  instance: string | null;
}

/** `open` é o estado conectado da Evolution API. */
export function whatsappConectado(status: StatusDoWhatsapp | null): boolean {
  return status?.state === 'open';
}

export function FaixaConexao({ status }: { status: StatusDoWhatsapp | null }) {
  if (!status) {
    return <p className="font-body-sm text-body-sm text-text-muted">Verificando a conexão do WhatsApp...</p>;
  }

  if (whatsappConectado(status)) {
    return (
      <p className="font-body-sm text-body-sm text-success-text flex items-center gap-1.5">
        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-success-text" />
        Conectada{status.instance ? ` • ${status.instance}` : ''}
      </p>
    );
  }

  const naoConfigurado = status.state === 'not_configured';
  return (
    <p role="alert" className="font-body-sm text-body-sm text-danger-text flex flex-wrap items-center gap-1.5">
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-danger-text" />
      {naoConfigurado ? 'WhatsApp não configurado.' : 'WhatsApp desconectado.'}
      <Link
        href={naoConfigurado ? '/whatsapp/configuracao' : '/whatsapp/conexao'}
        className="text-primary font-semibold hover:underline"
      >
        {naoConfigurado ? 'Configurar o WhatsApp' : 'Reconectar o WhatsApp'}
      </Link>
    </p>
  );
}

// T-190 (fase4-whatsapp, US-124): tipos e formatação compartilhados pelas telas
// de WhatsApp (caixa de entrada e nova mensagem avulsa).
export interface ConversaView {
  chave: string;
  leadId: string | null;
  numero: string;
  nome: string | null;
  ultimaMensagem: string;
  ultimaEm: string;
  ultimaDirecao: 'enviada' | 'recebida';
  naoLidas: number;
  respondida: boolean;
  card: {
    id: string;
    etapaId: number;
    valor: string | null;
    responsavel: { id: string; nome: string } | null;
  } | null;
}

export interface RespostaConversasView {
  conversas: ConversaView[];
  contagens: { naoLidas: number; minhas: number; todas: number };
  resumo: { ativasHoje: number; naoLidas: number; mensagensHoje: { recebidas: number; enviadas: number } };
}

/** "5511988880001" → "+55 (11) 98888-0001"; formatos fora do padrão BR voltam como "+<dígitos>". */
export function formatarNumero(numero: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(numero);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${numero}`;
}

export function nomeDaConversa(c: Pick<ConversaView, 'nome' | 'numero'>): string {
  return c.nome ?? formatarNumero(c.numero);
}

export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter((p) => /[A-Za-zÀ-ú]/.test(p[0] ?? ''));
  const letras = (partes.length ? partes : [nome]).slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letras.join('') || '#';
}

/** Hora (hoje) ou dia/mês (antes de hoje), no fuso de São Paulo. */
export function horarioCurto(iso: string, agora: Date = new Date()): string {
  const f = (d: Date, opcoes: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes }).format(d);
  const data = new Date(iso);
  const mesmoDia = f(data, { day: '2-digit', month: '2-digit', year: 'numeric' }) === f(agora, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return mesmoDia ? f(data, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : f(data, { day: '2-digit', month: '2-digit' });
}

/** AC-504/AC-514: o motivo, em português, de cada recusa do envio. */
export const MENSAGENS_DE_ERRO_DO_ENVIO: Record<string, string> = {
  WHATSAPP_NAO_CONFIGURADO: 'O WhatsApp da empresa não está configurado.',
  NUMERO_SEM_WHATSAPP: 'Este número não tem WhatsApp.',
  FALHA_ENVIO: 'Falha no envio. Tente de novo.',
  LEAD_SEM_TELEFONE: 'Este lead não tem telefone cadastrado.',
  REQUISICAO_INVALIDA: 'Confira o número e a mensagem.',
  NAO_AUTENTICADO: 'Sua sessão expirou. Entre novamente.',
};

export const MENSAGEM_ERRO_PADRAO_DO_ENVIO = 'Não foi possível enviar a mensagem. Tente de novo.';

export function mensagemDeErroDoEnvio(codigo: string | undefined): string {
  return (codigo && MENSAGENS_DE_ERRO_DO_ENVIO[codigo]) || MENSAGEM_ERRO_PADRAO_DO_ENVIO;
}

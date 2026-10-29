// T-259 (fase5-email-config, AC-699, ASM-260): as variáveis do corpo do e-mail da campanha. Função pura, usada pela
// prévia (cliente) e pelo disparo (worker). `{{nome}}` é o nome completo, `{{primeiro_nome}}` só o primeiro; as grafias
// do motor anterior (`{{Nome}}`, `{nome}`, `{Nome}`, `[nome]`, `[Nome]`) continuam valendo; o nome é escapado como HTML.
import { primeiroNome } from '../whatsapp/template';

export const NOME_PADRAO_DO_DESTINATARIO = 'Cliente';

const VARIAVEL = /\{\{\s*(nome|Nome|primeiro_nome)\s*\}\}|\{(nome|Nome)\}|\[(nome|Nome)\]/g;

export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderizarCorpoDeCampanha(corpoHtml: string, nomeDoDestinatario: string | null | undefined): string {
  const completo = (nomeDoDestinatario ?? '').trim().replace(/\s+/g, ' ') || NOME_PADRAO_DO_DESTINATARIO;
  const primeiro = primeiroNome(completo) || NOME_PADRAO_DO_DESTINATARIO;
  return corpoHtml.replace(VARIAVEL, (_todo, duplas?: string) => escaparHtml(duplas === 'primeiro_nome' ? primeiro : completo));
}

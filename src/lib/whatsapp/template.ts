// T-245 (fase5-whatsapp-lote-base, AC-670/AC-675, ASM-242): regras puras do template de mensagem —
// as únicas variáveis aceitas e o preenchimento com o nome do lead.
export const VARIAVEIS_DO_TEMPLATE = ['nome', 'primeiro_nome'] as const;
/** AC-673: o que cada variável vira, para a tela explicar todos os shortcodes que existem. */
export const AJUDA_DAS_VARIAVEIS: Record<(typeof VARIAVEIS_DO_TEMPLATE)[number], string> = {
  nome: 'O nome completo do lead, como está no cadastro.',
  primeiro_nome: 'Só o primeiro nome do lead.',
};
export const NOME_MINIMO = 2;
export const NOME_MAXIMO = 60;
export const CORPO_MAXIMO = 1000;

const VARIAVEL = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Variáveis `{{x}}` do corpo que o sistema não conhece (repetidas aparecem uma vez). */
export function variaveisInvalidas(corpo: string): string[] {
  const achadas = new Set<string>();
  for (const m of corpo.matchAll(VARIAVEL)) if (!(VARIAVEIS_DO_TEMPLATE as readonly string[]).includes(m[1])) achadas.add(m[1] || '{{}}');
  return [...achadas];
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? '';
}

/** AC-675: o corpo com `{{nome}}` e `{{primeiro_nome}}` trocados pelos do lead. */
export function renderizarTemplate(corpo: string, nomeDoLead: string): string {
  return corpo.replace(VARIAVEL, (_todo, variavel: string) => (variavel === 'primeiro_nome' ? primeiroNome(nomeDoLead) : variavel === 'nome' ? nomeDoLead.trim() : ''));
}

export type ResultadoDeValidacao = { ok: true; nome: string; corpo: string } | { ok: false; campo: 'nome' | 'corpo'; mensagem: string };

/** AC-670: nome de 2 a 60 caracteres, corpo de 1 a 1000 e só as variáveis conhecidas. */
export function validarTemplate(entrada: { nome: unknown; corpo: unknown }): ResultadoDeValidacao {
  const nome = typeof entrada.nome === 'string' ? entrada.nome.trim().replace(/\s+/g, ' ') : '';
  const corpo = typeof entrada.corpo === 'string' ? entrada.corpo.trim() : '';
  if (nome.length < NOME_MINIMO || nome.length > NOME_MAXIMO) return { ok: false, campo: 'nome', mensagem: `O nome deve ter de ${NOME_MINIMO} a ${NOME_MAXIMO} caracteres.` };
  if (corpo.length < 1 || corpo.length > CORPO_MAXIMO) return { ok: false, campo: 'corpo', mensagem: `A mensagem deve ter de 1 a ${CORPO_MAXIMO} caracteres.` };
  const invalidas = variaveisInvalidas(corpo);
  if (invalidas.length > 0) return { ok: false, campo: 'corpo', mensagem: `Variável desconhecida: ${invalidas.map((v) => `{{${v}}}`).join(', ')}. Use {{nome}} ou {{primeiro_nome}}.` };
  return { ok: true, nome, corpo };
}

// T-245 (fase5-whatsapp-lote-base, AC-670/AC-675, ASM-242): regras puras do template de mensagem —
// as únicas variáveis aceitas e o preenchimento com o nome do lead.
export type GrupoDaVariavel = 'Lead' | 'Card' | 'Reunião' | 'Empresa e data';

export interface DefinicaoDaVariavel {
  chave: string;
  grupo: GrupoDaVariavel;
  /** O que a variável vira. */
  ajuda: string;
  /** Valor de exemplo para prévias (telas de template). */
  exemplo: string;
}

/** O catálogo único de shortcodes: validação, tela de ajuda, prévia e envio leem daqui. */
export const VARIAVEIS: readonly DefinicaoDaVariavel[] = [
  { chave: 'nome', grupo: 'Lead', ajuda: 'O nome completo do lead, como está no cadastro.', exemplo: 'Maria Souza' },
  { chave: 'primeiro_nome', grupo: 'Lead', ajuda: 'Só o primeiro nome do lead.', exemplo: 'Maria' },
  { chave: 'telefone', grupo: 'Lead', ajuda: 'O telefone principal do lead, formatado.', exemplo: '(11) 98888-0001' },
  { chave: 'email', grupo: 'Lead', ajuda: 'O e-mail do lead.', exemplo: 'maria@clinica.com.br' },
  { chave: 'especialidade', grupo: 'Lead', ajuda: 'A especialidade do lead.', exemplo: 'Cardiologia' },
  { chave: 'origem', grupo: 'Lead', ajuda: 'De onde o lead veio (anúncio, indicação…).', exemplo: 'Meta Ads' },
  { chave: 'etapa', grupo: 'Card', ajuda: 'A etapa atual do card no pipeline.', exemplo: 'Reunião Agendada' },
  { chave: 'valor', grupo: 'Card', ajuda: 'O valor do card, em reais.', exemplo: 'R$ 6.800,00' },
  { chave: 'plano', grupo: 'Card', ajuda: 'O plano negociado no card.', exemplo: 'Profissional' },
  { chave: 'responsavel', grupo: 'Card', ajuda: 'O nome de quem é responsável pelo card.', exemplo: 'Juliana Rocha' },
  { chave: 'primeiro_nome_responsavel', grupo: 'Card', ajuda: 'Só o primeiro nome do responsável pelo card.', exemplo: 'Juliana' },
  { chave: 'link_meet', grupo: 'Reunião', ajuda: 'O link do Google Meet da reunião do card (precisa ter sido criado na agenda).', exemplo: 'https://meet.google.com/abc-defg-hij' },
  { chave: 'data_reuniao', grupo: 'Reunião', ajuda: 'A data da próxima reunião do card.', exemplo: '12/11/2026' },
  { chave: 'hora_reuniao', grupo: 'Reunião', ajuda: 'A hora da próxima reunião do card (horário de Brasília).', exemplo: '14:30' },
  { chave: 'dia_semana_reuniao', grupo: 'Reunião', ajuda: 'O dia da semana da próxima reunião do card.', exemplo: 'quinta-feira' },
  { chave: 'empresa', grupo: 'Empresa e data', ajuda: 'O nome da sua empresa.', exemplo: 'MedGuia' },
  { chave: 'saudacao', grupo: 'Empresa e data', ajuda: '"Bom dia", "Boa tarde" ou "Boa noite", conforme a hora do envio.', exemplo: 'Bom dia' },
  { chave: 'data_hoje', grupo: 'Empresa e data', ajuda: 'A data de hoje.', exemplo: '05/11/2026' },
];

export const VARIAVEIS_DO_TEMPLATE: readonly string[] = VARIAVEIS.map((v) => v.chave);
/** AC-673: o que cada variável vira, para a tela explicar todos os shortcodes que existem. */
export const AJUDA_DAS_VARIAVEIS: Record<string, string> = Object.fromEntries(VARIAVEIS.map((v) => [v.chave, v.ajuda]));
/** Os dados de exemplo para as prévias. */
export const CONTEXTO_DE_EXEMPLO: ContextoDoTemplate = Object.fromEntries(VARIAVEIS.map((v) => [v.chave, v.exemplo]));

/** Os valores já resolvidos de cada variável; o que falta (ou vem vazio) é "pendente". */
export type ContextoDoTemplate = Record<string, string | null | undefined>;
export const NOME_MINIMO = 2;
export const NOME_MAXIMO = 60;
export const CORPO_MAXIMO = 1000;

const VARIAVEL = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Variáveis `{{x}}` do corpo que o sistema não conhece (repetidas aparecem uma vez). */
export function variaveisInvalidas(corpo: string): string[] {
  const achadas = new Set<string>();
  for (const m of corpo.matchAll(VARIAVEL)) if (!VARIAVEIS_DO_TEMPLATE.includes(m[1])) achadas.add(m[1] || '{{}}');
  return [...achadas];
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? '';
}

function partesEmSaoPaulo(agora: Date) {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false, day: '2-digit', month: '2-digit', year: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(agora).map((x) => [x.type, x.value]));
  return { hora: Number(p.hour) % 24, data: `${p.day}/${p.month}/${p.year}` };
}

/** "Bom dia" até 11h59, "Boa tarde" até 17h59, "Boa noite" depois (horário de Brasília). */
export function saudacaoDaHora(agora: Date): string {
  const { hora } = partesEmSaoPaulo(agora);
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
}

export interface OpcoesDeRenderizacao {
  /** Variável sem valor: `true` deixa o `{{shortcode}}` no texto (a pessoa vê e completa); `false` troca por vazio. */
  manterPendentes?: boolean;
  agora?: Date;
}

/**
 * AC-675: o corpo com os shortcodes trocados pelos dados. O 2º argumento é o contexto resolvido (ou, por compatibilidade, só
 * o nome do lead). `primeiro_nome`, `primeiro_nome_responsavel`, `saudacao` e `data_hoje` são derivados quando não vêm prontos.
 */
export function renderizarTemplate(corpo: string, contexto: string | ContextoDoTemplate, opcoes: OpcoesDeRenderizacao = {}): string {
  const dados: ContextoDoTemplate = typeof contexto === 'string' ? { nome: contexto } : { ...contexto };
  const agora = opcoes.agora ?? new Date();
  const limpo = (chave: string) => (dados[chave] ?? '').toString().trim();
  dados.primeiro_nome ||= primeiroNome(limpo('nome'));
  dados.primeiro_nome_responsavel ||= primeiroNome(limpo('responsavel'));
  dados.saudacao ||= saudacaoDaHora(agora);
  dados.data_hoje ||= partesEmSaoPaulo(agora).data;
  return corpo.replace(VARIAVEL, (todo, variavel: string) => {
    if (!VARIAVEIS_DO_TEMPLATE.includes(variavel)) return '';
    const valor = limpo(variavel);
    if (valor) return valor;
    return opcoes.manterPendentes ? todo : '';
  });
}

export type ResultadoDeValidacao = { ok: true; nome: string; corpo: string } | { ok: false; campo: 'nome' | 'corpo'; mensagem: string };

/** AC-670: nome de 2 a 60 caracteres, corpo de 1 a 1000 e só as variáveis conhecidas. */
export function validarTemplate(entrada: { nome: unknown; corpo: unknown }): ResultadoDeValidacao {
  const nome = typeof entrada.nome === 'string' ? entrada.nome.trim().replace(/\s+/g, ' ') : '';
  const corpo = typeof entrada.corpo === 'string' ? entrada.corpo.trim() : '';
  if (nome.length < NOME_MINIMO || nome.length > NOME_MAXIMO) return { ok: false, campo: 'nome', mensagem: `O nome deve ter de ${NOME_MINIMO} a ${NOME_MAXIMO} caracteres.` };
  if (corpo.length < 1 || corpo.length > CORPO_MAXIMO) return { ok: false, campo: 'corpo', mensagem: `A mensagem deve ter de 1 a ${CORPO_MAXIMO} caracteres.` };
  const invalidas = variaveisInvalidas(corpo);
  if (invalidas.length > 0) return { ok: false, campo: 'corpo', mensagem: `Variável desconhecida: ${invalidas.map((v) => `{{${v}}}`).join(', ')}. Veja a lista de variáveis disponíveis nesta tela.` };
  return { ok: true, nome, corpo };
}

'use client';

// T-287 (fase4-pipeline-telas, US-109, AC-736): modal "Editar card" — nome, e-mail, origem, telefone principal e valor estimado.
// Só valida o básico (nome, origem e telefone não podem ficar vazios) e devolve o que o usuário digitou; quem chama a API
// (`PATCH /api/oportunidades/:id`) é a página, que também mostra o erro do servidor aqui em `erro` (telefone repetido, valor
// obrigatório na Proposta etc.).
import { useState } from 'react';
import { ESPECIALIDADES_PADRAO } from '@/domain/leads/especialidades';

export interface ValoresEdicaoCard {
  nome: string;
  email: string;
  origem: string;
  telefone: string;
  valor: string;
  especialidade: string;
}

export interface ResultadoEdicaoCard {
  ok: boolean;
  erro?: string;
  campo?: keyof ValoresEdicaoCard;
}

interface ModalEditarCardProps {
  inicial: ValoresEdicaoCard;
  onFechar: () => void;
  onSalvar: (valores: ValoresEdicaoCard) => Promise<ResultadoEdicaoCard>;
}

const CLASSE_CAMPO =
  'w-full h-10 px-3 bg-surface-subtle rounded-xl font-body-md text-body-md text-text-primary placeholder:text-text-muted focus:bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all';

const CAMPOS: Array<{ chave: keyof ValoresEdicaoCard; rotulo: string; obrigatorio: boolean; tipo: string; dica?: string }> = [
  { chave: 'nome', rotulo: 'Nome do lead', obrigatorio: true, tipo: 'text' },
  { chave: 'telefone', rotulo: 'Telefone principal', obrigatorio: true, tipo: 'tel', dica: 'Com DDD. Ex.: (11) 98765-4321' },
  { chave: 'email', rotulo: 'E-mail', obrigatorio: false, tipo: 'email' },
  { chave: 'origem', rotulo: 'Origem', obrigatorio: true, tipo: 'text' },
  { chave: 'especialidade', rotulo: 'Especialidade', obrigatorio: false, tipo: 'text', dica: 'Escolha da lista ou digite; variações conhecidas (ex.: Fisioterapeuta) viram o nome padrão' },
  { chave: 'valor', rotulo: 'Valor estimado (R$/mês)', obrigatorio: false, tipo: 'text', dica: 'Deixe vazio para tirar o valor' },
];

export function ModalEditarCard({ inicial, onFechar, onSalvar }: ModalEditarCardProps) {
  const [valores, setValores] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<{ campo?: keyof ValoresEdicaoCard; mensagem: string } | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    for (const campo of CAMPOS) {
      if (campo.obrigatorio && valores[campo.chave].trim() === '') {
        setErro({ campo: campo.chave, mensagem: `Informe ${campo.rotulo.toLowerCase()}.` });
        return;
      }
    }
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await onSalvar(valores);
      if (!resultado.ok) setErro({ campo: resultado.campo, mensagem: resultado.erro ?? 'Não foi possível salvar. Tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="editar-card-titulo">
      <form onSubmit={enviar} className="w-full max-w-lg bg-surface-card rounded-2xl shadow-xl p-space-lg flex flex-col gap-space-md">
        <h2 id="editar-card-titulo" className="font-headline-sm text-headline-sm text-text-primary">
          Editar card
        </h2>
        {CAMPOS.map((campo) => (
          <div key={campo.chave} className="flex flex-col gap-1">
            <label htmlFor={`editar-card-${campo.chave}`} className="font-label-md text-label-md text-text-secondary">
              {campo.rotulo}
              {campo.obrigatorio && ' *'}
            </label>
            <input
              id={`editar-card-${campo.chave}`}
              type={campo.tipo}
              value={valores[campo.chave]}
              onChange={(e) => setValores((atual) => ({ ...atual, [campo.chave]: e.target.value }))}
              aria-invalid={erro?.campo === campo.chave}
              className={CLASSE_CAMPO}
              list={campo.chave === 'especialidade' ? 'editar-card-especialidades' : undefined}
            />
            {campo.dica && <span className="font-body-sm text-text-muted text-[11px]">{campo.dica}</span>}
            {erro?.campo === campo.chave && <span className="font-body-sm text-danger-text">{erro.mensagem}</span>}
          </div>
        ))}
        <datalist id="editar-card-especialidades">
          {ESPECIALIDADES_PADRAO.map((nome) => (
            <option key={nome} value={nome} />
          ))}
        </datalist>
        {erro && !erro.campo && <p className="font-body-sm text-danger-text">{erro.mensagem}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="h-10 px-4 rounded-xl bg-surface-subtle hover:bg-surface-container font-label-md text-label-md font-semibold text-text-primary transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md transition-all disabled:opacity-60"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}

'use client';

// T-272 (fase5-email-descadastro, US-174, AC-715): a pessoa abre o link, vê de qual empresa e qual e-mail (mascarado) e
// CONFIRMA — abrir a página não descadastra (programas de e-mail abrem links sozinhos). Link inválido não diz nada da empresa.
import { useEffect, useState } from 'react';

type Estado = { tipo: 'carregando' } | { tipo: 'invalido' } | { tipo: 'pergunta'; empresaNome: string; emailMascarado: string } | { tipo: 'feito'; empresaNome: string } | { tipo: 'erro' };

export function Descadastro({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [trabalhando, setTrabalhando] = useState(false);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await fetch(`/api/descadastro/${token}`);
        if (!ativo) return;
        if (!r?.ok) return setEstado({ tipo: 'invalido' });
        const corpo = (await r.json()) as { empresaNome: string; emailMascarado: string };
        setEstado({ tipo: 'pergunta', ...corpo });
      } catch {
        if (ativo) setEstado({ tipo: 'erro' });
      }
    })();
    return () => {
      ativo = false;
    };
  }, [token]);

  async function confirmar(empresaNome: string) {
    setTrabalhando(true);
    try {
      const r = await fetch(`/api/descadastro/${token}`, { method: 'POST' });
      setEstado(r?.ok ? { tipo: 'feito', empresaNome } : { tipo: 'invalido' });
    } catch {
      setEstado({ tipo: 'erro' });
    } finally {
      setTrabalhando(false);
    }
  }

  if (estado.tipo === 'carregando') return <p className="font-body-md text-body-md text-text-secondary">Carregando…</p>;
  if (estado.tipo === 'invalido') {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-headline-md text-headline-md text-text-primary">Link inválido</h1>
        <p className="font-body-md text-body-md text-text-secondary">Este link de descadastro não é válido ou expirou.</p>
      </div>
    );
  }
  if (estado.tipo === 'erro') {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-headline-md text-headline-md text-text-primary">Algo deu errado</h1>
        <p role="alert" className="font-body-md text-body-md text-danger-text">Não foi possível concluir agora. Tente de novo em instantes.</p>
      </div>
    );
  }
  if (estado.tipo === 'feito') {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h1 className="font-headline-md text-headline-md text-text-primary">Pronto</h1>
        <p className="font-body-md text-body-md text-text-secondary">Você não receberá mais e-mails de {estado.empresaNome}.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-space-md">
      <h1 className="font-headline-md text-headline-md text-text-primary">Deseja deixar de receber e-mails de {estado.empresaNome}?</h1>
      <p className="font-body-md text-body-md text-text-secondary">O endereço {estado.emailMascarado} deixará de receber as mensagens desta empresa.</p>
      <button
        type="button"
        disabled={trabalhando}
        onClick={() => void confirmar(estado.empresaNome)}
        className="h-11 rounded-xl bg-primary text-on-primary font-label-lg text-label-lg font-semibold shadow-md disabled:opacity-50"
      >
        Confirmar descadastro
      </button>
    </div>
  );
}

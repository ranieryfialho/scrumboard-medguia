'use client';

// T-287 (fase4-pipeline-telas, US-109, AC-738): botão que copia um texto (telefone ou e-mail) para a área de transferência e
// avisa "Copiado" por um instante. Se o navegador recusar (página sem HTTPS, permissão negada), mostra "Não foi possível copiar".
import { useEffect, useState } from 'react';

type Estado = 'parado' | 'copiado' | 'falhou';

export function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [estado, setEstado] = useState<Estado>('parado');

  useEffect(() => {
    if (estado === 'parado') return;
    const espera = setTimeout(() => setEstado('parado'), 1800);
    return () => clearTimeout(espera);
  }, [estado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiado');
    } catch {
      setEstado('falhou');
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={copiar}
        aria-label={rotulo}
        title={rotulo}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-primary hover:bg-surface-subtle transition-colors"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
          {estado === 'copiado' ? 'check' : 'content_copy'}
        </span>
      </button>
      <span role="status" className={estado === 'falhou' ? 'text-[10px] text-danger-text' : 'text-[10px] text-success-text'}>
        {estado === 'copiado' ? 'Copiado' : estado === 'falhou' ? 'Não foi possível copiar' : ''}
      </span>
    </span>
  );
}

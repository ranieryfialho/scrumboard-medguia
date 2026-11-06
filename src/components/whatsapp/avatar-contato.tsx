'use client';

import { useState } from 'react';

import { iniciais } from './comum';

interface AvatarContatoProps {
  /** Número do contato (só dígitos); a foto vem de `/api/whatsapp/foto`. */
  numero?: string;
  /** Alternativa ao número: o servidor acha o telefone do lead (o card do funil só conhece o lead). */
  leadId?: string | null;
  /** Nome para as iniciais, usadas enquanto a foto não carrega ou quando o contato não tem foto. */
  nome: string;
  className: string;
}

/** A foto do contato no WhatsApp; sem foto (ou foto oculta pela privacidade dele), as iniciais de sempre. */
export function AvatarContato({ numero, leadId, nome, className }: AvatarContatoProps) {
  const [semFotoPara, setSemFotoPara] = useState<string | null>(null);
  const consulta = leadId ? `leadId=${encodeURIComponent(leadId)}` : numero ? `numero=${encodeURIComponent(numero)}` : null;

  if (!consulta || semFotoPara === consulta) {
    return (
      <span aria-hidden="true" className={className}>
        {iniciais(nome)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- imagem do próprio CRM (cache da foto), com tamanho fixo e fallback nas iniciais
    <img
      src={`/api/whatsapp/foto?${consulta}`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setSemFotoPara(consulta)}
      className={`${className} object-cover`}
    />
  );
}

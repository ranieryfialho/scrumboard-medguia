'use client';

// T-309 (fase4-campanhas, US-130): "Checklist de Qualidade do Disparo" — quatro verificações reais sobre o e-mail em edição:
// o DNS do remetente (SPF/DKIM/DMARC, `GET /api/campanhas/entregabilidade`), as variáveis, o link de descadastro (que o
// envio acrescenta sozinho) e os pontos de atenção de spam. Nada aqui promete que o e-mail chega: aponta o que costuma dar problema.
import { useEffect, useMemo, useState } from 'react';

import { pontosDeAtencao, variaveisDesconhecidas } from '@/lib/campanhas/checklist';

interface Entregabilidade {
  remetenteConfigurado: boolean;
  dominio: string | null;
  spf: boolean;
  dkim: boolean;
  dmarc: { achado: boolean; politica: string | null };
}

type Nivel = 'ok' | 'atencao' | 'carregando';

function Linha({ nivel, titulo, estado, detalhe }: { nivel: Nivel; titulo: string; estado: string; detalhe?: React.ReactNode }) {
  const cor = nivel === 'ok' ? 'text-success-text' : nivel === 'atencao' ? 'text-warning-text' : 'text-text-muted';
  const icone = nivel === 'ok' ? 'check_circle' : nivel === 'atencao' ? 'warning' : 'hourglass_top';
  return (
    <li className="rounded-xl bg-surface-subtle p-3 flex items-start gap-3">
      <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${cor}`}>{icone}</span>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-start justify-between gap-3">
          <span className="font-label-md text-label-md text-text-primary">{titulo}</span>
          <span className={`font-label-sm text-label-sm font-semibold shrink-0 ${cor}`}>{estado}</span>
        </div>
        {detalhe && <div className="font-body-sm text-body-sm text-text-muted">{detalhe}</div>}
      </div>
    </li>
  );
}

export function ChecklistDoDisparo({ assunto, corpoHtml }: { assunto: string; corpoHtml: string }) {
  const [dns, setDns] = useState<Entregabilidade | null | undefined>(undefined);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/campanhas/entregabilidade')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Entregabilidade | null) => !cancelado && setDns(d))
      .catch(() => !cancelado && setDns(null));
    return () => {
      cancelado = true;
    };
  }, []);

  const desconhecidas = useMemo(() => variaveisDesconhecidas(corpoHtml), [corpoHtml]);
  const pontos = useMemo(() => pontosDeAtencao(assunto, corpoHtml), [assunto, corpoHtml]);

  const registros = dns ? [dns.spf, dns.dkim, dns.dmarc.achado] : [];
  const faltando = dns ? [!dns.spf && 'SPF', !dns.dkim && 'DKIM', !dns.dmarc.achado && 'DMARC'].filter(Boolean) : [];

  return (
    <section aria-label="Checklist de Qualidade do Disparo" className="bg-surface-card rounded-2xl p-space-md shadow-sm flex flex-col gap-space-sm">
      <h2 className="font-headline-sm text-headline-sm text-text-primary flex items-center gap-2">
        <span aria-hidden="true" className="material-symbols-outlined text-[22px] text-success-text">fact_check</span>
        Checklist de Qualidade do Disparo
      </h2>
      <ul className="flex flex-col gap-2">
        {dns === undefined ? (
          <Linha nivel="carregando" titulo="Reputação do remetente (SPF/DKIM/DMARC)" estado="Verificando..." />
        ) : dns === null || dns.dominio === null ? (
          <Linha nivel="atencao" titulo="Reputação do remetente (SPF/DKIM/DMARC)" estado="Sem verificação" detalhe="Não foi possível consultar o domínio do remetente." />
        ) : (
          <Linha
            nivel={faltando.length === 0 ? 'ok' : 'atencao'}
            titulo="Reputação do remetente (SPF/DKIM/DMARC)"
            estado={faltando.length === 0 ? 'Ótima' : `${registros.filter(Boolean).length} de 3`}
            detalhe={
              <>
                Domínio <strong>{dns.dominio}</strong>
                {!dns.remetenteConfigurado && ' (remetente padrão do sistema)'}.{' '}
                {faltando.length > 0 ? `Falta no DNS: ${faltando.join(', ')}.` : 'Os três registros foram encontrados.'}
                {dns.dmarc.achado && dns.dmarc.politica === 'none' && ' O DMARC está só monitorando (p=none).'}
              </>
            }
          />
        )}
        <Linha
          nivel={desconhecidas.length === 0 ? 'ok' : 'atencao'}
          titulo="Variáveis dinâmicas"
          estado={desconhecidas.length === 0 ? 'Válidas' : `${desconhecidas.length} desconhecida${desconhecidas.length === 1 ? '' : 's'}`}
          detalhe={desconhecidas.length === 0 ? 'Só {{nome}} e {{primeiro_nome}} são trocadas no envio.' : `Não serão trocadas: ${desconhecidas.map((v) => `{{${v}}}`).join(', ')}.`}
        />
        <Linha nivel="ok" titulo="Link de descadastramento (LGPD)" estado="Presente" detalhe="O envio acrescenta o link no rodapé e o cabeçalho de um clique." />
        <Linha
          nivel={pontos.length === 0 ? 'ok' : 'atencao'}
          titulo="Boas práticas anti-spam"
          estado={pontos.length === 0 ? 'Sem alertas' : `${pontos.length} ${pontos.length === 1 ? 'alerta' : 'alertas'}`}
          detalhe={
            pontos.length > 0 ? (
              <ul className="list-disc pl-4">
                {pontos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              'Assunto, imagens, links e tamanho do HTML estão dentro do esperado.'
            )
          }
        />
      </ul>
    </section>
  );
}

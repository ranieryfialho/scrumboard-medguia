'use client';

// T-238 (fase5-empresa-dados, AC-657/AC-658): os campos cadastrais da empresa (razão social, CNPJ,
// endereço, plano e assentos), compartilhados pela tela de nova empresa e pela de edição. Cada campo
// mostra o próprio erro; os valores ficam como texto até o envio (`corpoDosDados`).
import { PLANOS, ROTULO_DO_PLANO, UFS } from '@/lib/empresa/validacao';

export interface ValoresDaEmpresa {
  razaoSocial: string;
  cnpj: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  plano: string;
  assentos: string;
}

export const VALORES_VAZIOS: ValoresDaEmpresa = { razaoSocial: '', cnpj: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', plano: '', assentos: '' };

export type ErrosDaEmpresa = Partial<Record<keyof ValoresDaEmpresa | 'geral', string>>;

/** Os dados do detalhe da empresa (campos anuláveis) como valores de formulário. */
export function valoresDaEmpresa(e: Partial<Record<keyof ValoresDaEmpresa, string | number | null>>): ValoresDaEmpresa {
  const v = { ...VALORES_VAZIOS };
  for (const campo of Object.keys(v) as Array<keyof ValoresDaEmpresa>) v[campo] = e[campo] === null || e[campo] === undefined ? '' : String(e[campo]);
  return v;
}

/** O que vai no `POST`/`PATCH`: texto aparado, vazio como vazio e assentos como número. */
export function corpoDosDados(v: ValoresDaEmpresa): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  for (const campo of Object.keys(v) as Array<keyof ValoresDaEmpresa>) {
    if (campo === 'assentos') continue;
    corpo[campo] = v[campo].trim();
  }
  corpo.assentos = v.assentos.trim() === '' ? '' : Number(v.assentos.trim());
  return corpo;
}

const CLASSE = 'h-10 px-3 rounded-xl bg-surface-subtle font-body-md text-body-md text-text-primary w-full focus:outline-none';
const ROTULO = 'flex flex-col gap-1 font-label-md text-label-md text-text-secondary';

interface Props {
  valores: ValoresDaEmpresa;
  onMudar: (proximo: ValoresDaEmpresa) => void;
  erros: ErrosDaEmpresa;
}

function Campo({ campo, rotulo, props, tipo = 'text', obrigatorio = false }: { campo: keyof ValoresDaEmpresa; rotulo: string; props: Props; tipo?: string; obrigatorio?: boolean }) {
  return (
    <label className={ROTULO}>
      {rotulo}
      {obrigatorio ? ' *' : ''}
      <input
        type={tipo}
        value={props.valores[campo]}
        onChange={(e) => props.onMudar({ ...props.valores, [campo]: e.target.value })}
        aria-label={rotulo}
        aria-invalid={props.erros[campo] ? true : undefined}
        className={CLASSE}
      />
      {props.erros[campo] && (
        <span role="alert" className="text-danger-text">
          {props.erros[campo]}
        </span>
      )}
    </label>
  );
}

export function CamposDeIdentificacao(props: Props & { criando?: boolean }) {
  return (
    <>
      <Campo campo="razaoSocial" rotulo="Razão social" props={props} obrigatorio={props.criando} />
      <Campo campo="cnpj" rotulo="CNPJ" props={props} obrigatorio={props.criando} />
    </>
  );
}

export function CamposDeEndereco(props: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
      <Campo campo="cep" rotulo="CEP" props={props} />
      <Campo campo="logradouro" rotulo="Logradouro" props={props} />
      <Campo campo="numero" rotulo="Número" props={props} />
      <Campo campo="complemento" rotulo="Complemento" props={props} />
      <Campo campo="bairro" rotulo="Bairro" props={props} />
      <Campo campo="cidade" rotulo="Cidade" props={props} />
      <label className={ROTULO}>
        UF
        <select value={props.valores.uf} onChange={(e) => props.onMudar({ ...props.valores, uf: e.target.value })} aria-label="UF" className={CLASSE}>
          <option value="">—</option>
          {UFS.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>
        {props.erros.uf && (
          <span role="alert" className="text-danger-text">
            {props.erros.uf}
          </span>
        )}
      </label>
    </div>
  );
}

export function CamposDePlano(props: Props & { criando?: boolean; emUso?: number }) {
  return (
    <>
      <label className={ROTULO}>
        Plano{props.criando ? ' *' : ''}
        <select value={props.valores.plano} onChange={(e) => props.onMudar({ ...props.valores, plano: e.target.value })} aria-label="Plano" className={CLASSE}>
          <option value="">{props.criando ? 'Escolha o plano' : '—'}</option>
          {PLANOS.map((p) => (
            <option key={p} value={p}>
              {ROTULO_DO_PLANO[p]}
            </option>
          ))}
        </select>
        {props.erros.plano && (
          <span role="alert" className="text-danger-text">
            {props.erros.plano}
          </span>
        )}
      </label>
      <Campo campo="assentos" rotulo="Assentos" props={props} tipo="number" obrigatorio={props.criando} />
      {props.emUso !== undefined && <span className="font-body-sm text-body-sm text-text-muted">{props.emUso} em uso (pessoas ativas ou com convite pendente). Vazio = sem limite.</span>}
    </>
  );
}

export interface Lead {
  id: string;
  nome: string;
  situacao: string;
  whatsapp?: string;
  cargo?: string;
  tipo?: string;
  responsavel?: string;
  email?: string;
  origem?: string;
  created_time?: string;
  data_alteracao?: string;
  data_fechamento?: string;
  anuncio?: string;
  observacoes?: string;
  o_que_mais_interessou?: string;
  o_que_deixou_a_desejar?: string;
  plano_escolhido?: string;
  plataforma_anterior?: string;
  por_onde_conheceu?: string;
  [key: string]: unknown;
}

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
  [key: string]: any;
}

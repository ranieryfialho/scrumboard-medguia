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
  anuncio?: string;
  [key: string]: any;
}
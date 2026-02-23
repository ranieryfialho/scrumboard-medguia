export interface Lead {
  id: string;
  nome: string;
  situacao: string;
  whatsapp?: string;
  cargo?: string;
  tipo?: string;
  responsavel?: string;
  email?: string;
  [key: string]: any;
}
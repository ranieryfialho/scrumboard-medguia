export interface Campanha {
  id: string;
  nome: string;
  assunto: string;
  corpo_html: string;
  status: string;
  criado_em: string;
}

export interface Destinatario {
  id: string;
  campanha_id: string;
  nome_destinatario: string;
  email_destinatario: string;
  status: string;
}

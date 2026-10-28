# Decisões de produto da fase 4 (roteiro visual)

Respostas do dono do produto às perguntas em aberto que ficaram nas specs das features
`fase4-*` (29/10/2026). Cada decisão vira uma feature própria (`fase5-*`); até lá, as telas
seguem mostrando o item como "em breve" ou sem o dado.

| Pergunta | Decisão | Vira feature |
|---|---|---|
| Q-049 — "Ligar Agora" do card | Abrir o discador do aparelho (`tel:`) com o telefone principal. O CRM não registra a ligação. | pequena, dentro de um ajuste do card |
| Q-050 — WhatsApp em lote | Valem as quatro regras: limite por disparo (ex.: 50 leads), intervalo entre mensagens (ex.: 15 a 45 s), exigir consentimento do lead e só templates aprovados. | `fase5-whatsapp-lote` (precisa de campo de consentimento no lead, cadastro de templates e fila de envio) |
| Q-051, Q-053, Q-056, Q-058 — metas e benchmarks | Criar uma **rota onde a gestão cadastra as metas** da empresa (presença em reuniões, tempo de 1ª resposta, win rate, receita do período, taxas de e-mail). Os indicadores passam a mostrar "meta atingida". | `fase5-metas` (migration `empresa_metas`, tela de metas só para gerente e master) |
| Q-052 — cancelar reunião | A reunião fica "cancelada" e o card volta para "Qualificado p/ reunião". | `fase5-agenda-cancelar` |
| Q-054 — número avulso | "Promover a Lead" cria o lead com o número e a conversa e um card em "Entrada de leads", tendo quem promove como responsável. | `fase5-whatsapp-promover` |
| Q-057 — investimento em mídia | Cadastro manual por canal (origem) e mês no CRM; o relatório de marketing passa a calcular CAC, ROAS e custo por lead. | `fase5-investimento-midia` (migration, tela de cadastro) |
| Q-059 — dados da empresa | A empresa guarda razão social, CNPJ, endereço, plano e número de assentos (com cota: o convite respeita o limite de assentos). | `fase5-empresa-dados` (migration) |
| Q-060 — motivos de perda | Passam a ser **por empresa**: os motivos sistêmicos continuam de todas; cada empresa cria e desativa os seus. | `fase5-motivos-por-empresa` (migration; regra para os motivos atuais) |
| Q-055 — pausar disparo e variáveis no motor de e-mail | **Aberta**: depende do motor externo (Python). | — |

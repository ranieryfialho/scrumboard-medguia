# 🏥 MedGuia Hub - Scrumboard & CRM de Leads Médicos

![Next.js](https://img.shields.io/badge/Next.js-15+-black?style=for-the-badge&logo=next.js)
![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css)
![Supabase](https://img.shields.io/badge/Supabase-Auth_%26_DB-3ECF8E?style=for-the-badge&logo=supabase)
![Google Sheets API](https://img.shields.io/badge/Google_Sheets-API-34A853?style=for-the-badge&logo=google-sheets)

O **MedGuia Hub** é um sistema completo de gerenciamento de leads e CRM desenvolvido especificamente para o nicho médico. Ele utiliza uma arquitetura híbrida inteligente, usando o **Google Sheets como fonte de verdade (Source of Truth) para os leads** e o **Supabase para Autenticação, Controle de Acessos (RBAC) e Fila de Campanhas de E-mail**.

---

## ✨ Principais Funcionalidades

- **🗂️ Kanban Interativo (Drag & Drop):** Gestão visual do funil de vendas utilizando `@dnd-kit`.
- **🔄 Sincronização Bidirecional:** Leitura e atualização de leads em tempo real diretamente em múltiplas planilhas do Google Sheets.
- **📊 Dashboard Analítico:** Acompanhamento de KPIs (Ativos, Novos, Em Andamento, Fechados) e gráficos de conversão por especialidade médica.
- **🤖 Relatórios com Integração de IA:** Exportação automática de relatórios de tráfego pago em formato de *Prompt* (Markdown) pronto para ser colado em IAs de apresentação (Gamma.app, Tome).
- **📧 Motor de Mala Direta:** Criação de campanhas de e-mail a partir das colunas do Kanban ou upload de Excel. O sistema gerencia a fila no Supabase para processamento via motor externo (ex: Python/SMTP) e escuta webhooks do *Resend* para rastrear aberturas e cliques.
- **🔐 Controle de Acesso (RBAC):** Níveis de permissão `MASTER`, `GERENTE` e `ATENDENTE` com autenticação segura via Supabase.

---

## 🛠️ Tecnologias Utilizadas

- **Core:** [Next.js](https://nextjs.org/) (App Router) + [React 19](https://react.dev/)
- **Estilização & UI:** [Tailwind CSS v4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [Lucide Icons](https://lucide.dev/)
- **Integrações:** Googleapis (Sheets), Supabase SSR
- **Componentes Dinâmicos:** `@dnd-kit` (Kanban), `Recharts` (Gráficos), `react-day-picker` (Calendário), `xlsx` (Upload de contatos)

---

## ⚙️ Pré-requisitos

Antes de começar, você precisará ter instalado em sua máquina:
- [Node.js](https://nodejs.org/) (v18 ou superior)
- Gerenciador de pacotes (`npm`, `yarn`, `pnpm` ou `bun`)
- Uma conta no [Supabase](https://supabase.com/)
- Credenciais do [Google Cloud Console](https://console.cloud.google.com/) (Service Account com acesso à API do Google Sheets)

---

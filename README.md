# Faro

Backoffice para bares e restaurantes com foco em gestão fiscal.

## Stack

- **Frontend**: React 19 + TypeScript + Vite
- **UI**: Tailwind CSS + shadcn/ui
- **Backend**: Supabase (Auth + Database)

## Estrutura

```
faro/
├── web/                 # Aplicação React
├── supabase/            # Configuração e migrations do Supabase
│   ├── config.toml
│   └── migrations/
└── README.md
```

## Setup

### 1. Supabase

1. Crie um projeto no [Supabase Dashboard](https://supabase.com/dashboard)
2. Execute as migrations na pasta `supabase/migrations/`:
   - Via Supabase CLI: `supabase db push`
   - Ou copie o SQL para o SQL Editor no dashboard

### 2. Web

**Requisito:** Node.js 20.19+ ou 22.12+

```bash
cd web
cp .env.example .env
# Edite .env com suas credenciais do Supabase:
# VITE_SUPABASE_URL=https://seu-projeto.supabase.co
# VITE_SUPABASE_ANON_KEY=sua-anon-key

npm install
npm run dev
```

Acesse http://localhost:5173

## Funcionalidades

- **Landing page** com apresentação do produto
- **Login** e **cadastro** de usuários
- **Cadastro de empresa** (bar/restaurante)
- **Múltiplas empresas** por usuário
- **Área logada** com sidebar e header
- **Dark mode** e **light mode**
- Dashboard e módulo de documentos fiscais (em desenvolvimento)

## Licença

Proprietário.

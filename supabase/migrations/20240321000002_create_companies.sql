-- Empresas (bares e restaurantes)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Tabela de associação usuário-empresa (N:N)
CREATE TABLE IF NOT EXISTS public.user_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'member' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, company_id)
);

ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

-- Políticas: usuários só veem/editan empresas em que participam
CREATE POLICY "Users can view their companies"
  ON public.companies FOR SELECT
  USING (
    id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can create companies"
  ON public.companies FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their companies"
  ON public.companies FOR UPDATE
  USING (
    id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view their user_companies"
  ON public.user_companies FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert user_companies for themselves"
  ON public.user_companies FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their user_companies"
  ON public.user_companies FOR DELETE
  USING (user_id = auth.uid());

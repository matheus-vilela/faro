-- Gerar cards de recebimento para despesas existentes que ainda não têm
INSERT INTO public.recebimentos (expense_id)
SELECT e.id
FROM public.expenses e
LEFT JOIN public.recebimentos r ON r.expense_id = e.id
WHERE r.id IS NULL;

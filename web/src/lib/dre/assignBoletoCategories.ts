import { supabase } from "@/lib/supabase";

/** Atribui company_category_id a vários boletos de uma vez. */
export async function assignBoletoCategories(input: {
  companyId: string;
  boletoIds: string[];
  categoryId: string;
}): Promise<void> {
  if (input.boletoIds.length === 0) return;
  const { error } = await supabase
    .from("boletos")
    .update({ company_category_id: input.categoryId })
    .eq("company_id", input.companyId)
    .in("id", input.boletoIds);
  if (error) throw error;
}

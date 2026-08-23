import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { Supplier } from "@/types/supplier";
import type { ReportResult, ReportRunContext } from "../types";

type SupplierRow = Supplier & {
  supplier_payment_info?: unknown;
};

export async function buildSuppliersReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  let q = supabase
    .from("suppliers")
    .select("*, supplier_payment_info (*)")
    .eq("company_id", ctx.companyId)
    .order("name");
  const search = ctx.filters.search.trim();
  if (search) {
    const term = `%${search}%`;
    q = q.or(
      `name.ilike.${term},document.ilike.${term},email.ilike.${term},sales_contact_name.ilike.${term},commercial_manager.ilike.${term}`,
    );
  }
  const rows = await fetchAllInRange<SupplierRow>(q);

  return {
    title: "Fornecedores",
    slug: "fornecedores",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      search ? `Busca: ${search}` : "Todos os fornecedores",
    ],
    tables: [
      {
        title: "Fornecedores",
        columns: [
          { key: "name", header: "Nome" },
          { key: "document", header: "CNPJ/CPF" },
          { key: "email", header: "E-mail" },
          { key: "phone", header: "Telefone" },
          { key: "sales", header: "Vendedor" },
          { key: "manager", header: "Gerente" },
          { key: "bank", header: "Banco" },
          { key: "agency", header: "Agência" },
          { key: "account", header: "Conta" },
          { key: "pix", header: "PIX" },
        ],
        rows: rows.map((s) => {
          const pi = Array.isArray(s.supplier_payment_info)
            ? s.supplier_payment_info[0]
            : s.supplier_payment_info;
          const pay = (pi ?? {}) as {
            bank_name?: string | null;
            agency?: string | null;
            account?: string | null;
            pix_key?: string | null;
          };
          return {
            name: s.name,
            document: s.document ?? "",
            email: s.email ?? "",
            phone: s.phone ?? "",
            sales: s.sales_contact_name ?? "",
            manager: s.commercial_manager ?? "",
            bank: pay.bank_name ?? "",
            agency: pay.agency ?? "",
            account: pay.account ?? "",
            pix: pay.pix_key ?? "",
          };
        }),
      },
    ],
  };
}

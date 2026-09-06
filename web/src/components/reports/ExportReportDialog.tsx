import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { MonthSelector } from "@/components/MonthSelector";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { getMonthYmdRange } from "@/lib/payableTotals";
import { normalizeWeekStartsOn } from "@/lib/vendasRealizadasResumo";
import {
  getReportDefinition,
  visibleReports,
} from "@/lib/reports/catalog";
import { countReportRows, downloadReport, reportHasRows } from "@/lib/reports/download";
import {
  buildReportFilename,
  defaultReportFilters,
} from "@/lib/reports/formatters";
import { runReport } from "@/lib/reports/runReport";
import { supabase } from "@/lib/supabase";
import type { ProductExportFilterState } from "@/lib/productCatalogFilters";
import type {
  ExportFormat,
  ReportFilterKey,
  ReportFilterState,
  ReportId,
} from "@/lib/reports/types";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Option = { id: string; name: string };

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ExportReportDialog({
  open,
  onOpenChange,
  reportId,
  allowedReportIds,
  initialFilters,
  stockFilters,
  lockReport = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: ReportId;
  allowedReportIds?: ReportId[];
  initialFilters?: Partial<ReportFilterState>;
  stockFilters?: ProductExportFilterState;
  lockReport?: boolean;
}) {
  const { isAdmin } = useAuth();
  const {
    currentCompany,
    currentPermissions,
    isCompanyOwner,
  } = useCompany();
  const catalog = useMemo(() => {
    const visible = visibleReports(
      currentPermissions,
      isCompanyOwner,
      Boolean(isAdmin),
    );
    if (!allowedReportIds?.length) return visible;
    const allow = new Set(allowedReportIds);
    return visible.filter((r) => allow.has(r.id));
  }, [allowedReportIds, currentPermissions, isAdmin, isCompanyOwner]);

  const [selectedId, setSelectedId] = useState<ReportId>(reportId);
  const [filters, setFilters] = useState<ReportFilterState>(() =>
    defaultReportFilters({
      ...getReportDefinition(reportId).defaults,
      ...initialFilters,
    }),
  );
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [banks, setBanks] = useState<Option[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(reportId);
    setFilters(
      defaultReportFilters({
        ...getReportDefinition(reportId).defaults,
        ...initialFilters,
      }),
    );
  }, [open, reportId, initialFilters]);

  const definition = getReportDefinition(selectedId);
  const filterSet = new Set<ReportFilterKey>(definition.filters);

  useEffect(() => {
    if (!open || !currentCompany?.id) return;
    const companyId = currentCompany.id;
    const keys = new Set(getReportDefinition(selectedId).filters);
    const needCat = keys.has("category");
    const needSup = keys.has("supplier");
    const needBank = keys.has("bankAccount");
    if (!needCat && !needSup && !needBank) return;
    void (async () => {
      const [catRes, supRes, bankRes] = await Promise.all([
        needCat
          ? supabase
              .from("company_categories")
              .select("id, name")
              .eq("company_id", companyId)
              .order("name")
          : Promise.resolve({ data: [] as Option[] }),
        needSup
          ? supabase
              .from("suppliers")
              .select("id, name")
              .eq("company_id", companyId)
              .order("name")
          : Promise.resolve({ data: [] as Option[] }),
        needBank
          ? supabase
              .from("company_bank_accounts")
              .select("id, name")
              .eq("company_id", companyId)
              .order("name")
          : Promise.resolve({ data: [] as Option[] }),
      ]);
      setCategories((catRes.data ?? []) as Option[]);
      setSuppliers((supRes.data ?? []) as Option[]);
      setBanks((bankRes.data ?? []) as Option[]);
    })();
  }, [open, currentCompany?.id, selectedId]);

  const patch = (partial: Partial<ReportFilterState>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const handleMonth = (month: number, year: number) => {
    const { startYmd, endYmd } = getMonthYmdRange(month, year);
    patch({ month, year, dateFrom: startYmd, dateTo: endYmd });
  };

  const handleGenerate = async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    try {
      const result = await runReport(selectedId, {
        companyId: currentCompany.id,
        companyName: currentCompany.name,
        filters,
        permissions: currentPermissions,
        isCompanyOwner,
        weekStartsOn: normalizeWeekStartsOn(
          currentCompany.accounting_week_starts_on,
        ),
        stockFilters,
      });
      if (!reportHasRows(result) && selectedId !== "dre" && selectedId !== "budget" && selectedId !== "cash_flow_summary") {
        toast.message("Nenhum registro para exportar com esses filtros.");
        return;
      }
      const filename = buildReportFilename({
        slug: result.slug,
        companyName: currentCompany.name,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      });
      downloadReport(result, format, filename);
      const n = countReportRows(result);
      toast.success(
        n === 1 ? "1 linha exportada." : `${n} linhas exportadas.`,
      );
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível gerar o relatório.",
      );
    } finally {
      setLoading(false);
    }
  };

  const showPicker = !lockReport && catalog.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Exportar relatório</DialogTitle>
          <DialogDescription>
            Escolha o formato e os filtros. O arquivo baixa no navegador.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {showPicker ? (
            <Field label="Relatório">
              <SearchSelect
                value={selectedId}
                onValueChange={(v) => {
                  const id = v as ReportId;
                  setSelectedId(id);
                  setFilters(
                    defaultReportFilters({
                      ...getReportDefinition(id).defaults,
                      ...initialFilters,
                    }),
                  );
                }}
                options={catalog.map((r) => ({
                  value: r.id,
                  label: r.title,
                }))}
                triggerClassName="w-full"
              />
            </Field>
          ) : (
            <p className="text-sm font-medium">{definition.title}</p>
          )}
          <p className="text-sm text-muted-foreground">{definition.description}</p>

          {filterSet.has("month") ? (
            <Field label="Mês">
              <MonthSelector
                value={{ month: filters.month, year: filters.year }}
                onChange={(v) => handleMonth(v.month, v.year)}
              />
            </Field>
          ) : null}

          {filterSet.has("period") ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="De">
                <Input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => patch({ dateFrom: e.target.value })}
                />
              </Field>
              <Field label="Até">
                <Input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => patch({ dateTo: e.target.value })}
                />
              </Field>
            </div>
          ) : null}

          {filterSet.has("dateField") ? (
            <Field label="Data de referência">
              <SearchSelect
                value={filters.dateField}
                onValueChange={(v) =>
                  patch({ dateField: v as ReportFilterState["dateField"] })
                }
                options={[
                  { value: "due_date", label: "Vencimento (competência)" },
                  { value: "paid_at", label: "Pagamento (caixa)" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("openDueBucket") ? (
            <Field label="Situação">
              <SearchSelect
                value={filters.openDueBucket}
                onValueChange={(v) =>
                  patch({
                    openDueBucket: v as ReportFilterState["openDueBucket"],
                  })
                }
                options={[
                  { value: "all", label: "Todas em aberto" },
                  { value: "overdue", label: "Somente vencidas" },
                  { value: "upcoming", label: "Somente a vencer" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("flowType") ? (
            <Field label="Tipo">
              <SearchSelect
                value={filters.flowType}
                onValueChange={(v) =>
                  patch({ flowType: v as ReportFilterState["flowType"] })
                }
                options={[
                  { value: "both", label: "Pagar e receber" },
                  { value: "payable", label: "Somente a pagar" },
                  { value: "receivable", label: "Somente a receber" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("situation") ? (
            <Field label="Quitação">
              <SearchSelect
                value={filters.situation}
                onValueChange={(v) =>
                  patch({ situation: v as ReportFilterState["situation"] })
                }
                options={[
                  { value: "all", label: "Todas" },
                  { value: "pending", label: "Em aberto" },
                  { value: "paid", label: "Pagas / recebidas" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("basis") ? (
            <Field label="Base">
              <SearchSelect
                value={filters.basis}
                onValueChange={(v) =>
                  patch({ basis: v as ReportFilterState["basis"] })
                }
                options={[
                  { value: "competencia", label: "Competência (vencimento)" },
                  { value: "caixa", label: "Caixa (pagamento)" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("natureza") ? (
            <Field label="Natureza">
              <SearchSelect
                value={filters.natureza}
                onValueChange={(v) =>
                  patch({ natureza: v as ReportFilterState["natureza"] })
                }
                options={[
                  { value: "all", label: "Todas" },
                  { value: "RECEITA", label: "Receita" },
                  { value: "DESPESA", label: "Despesa" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("category") ? (
            <Field label="Categoria">
              <SearchSelect
                value={filters.categoryId}
                onValueChange={(v) => patch({ categoryId: v })}
                options={categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
                leadingOptions={[{ value: "all", label: "Todas" }]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("supplier") ? (
            <Field label="Fornecedor">
              <SearchSelect
                value={filters.supplierId}
                onValueChange={(v) => patch({ supplierId: v })}
                options={suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                leadingOptions={[{ value: "all", label: "Todos" }]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("bankAccount") ? (
            <Field label="Conta bancária">
              <SearchSelect
                value={filters.bankAccountId}
                onValueChange={(v) => patch({ bankAccountId: v })}
                options={banks.map((b) => ({
                  value: b.id,
                  label: b.name,
                }))}
                leadingOptions={[{ value: "all", label: "Todas" }]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("search") ? (
            <Field label="Busca">
              <Input
                value={filters.search}
                onChange={(e) => patch({ search: e.target.value })}
                placeholder="Descrição, fornecedor…"
              />
            </Field>
          ) : null}

          {filterSet.has("expenseStatus") ? (
            <Field label="Status da nota">
              <SearchSelect
                value={filters.expenseStatus}
                onValueChange={(v) =>
                  patch({
                    expenseStatus: v as ReportFilterState["expenseStatus"],
                  })
                }
                options={[
                  { value: "all", label: "Todas" },
                  { value: "pending", label: "Pendente" },
                  { value: "approved", label: "Aprovada" },
                  { value: "rejected", label: "Rejeitada" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("expenseOrigin") ? (
            <Field label="Origem">
              <SearchSelect
                value={filters.expenseOrigin}
                onValueChange={(v) =>
                  patch({
                    expenseOrigin: v as ReportFilterState["expenseOrigin"],
                  })
                }
                options={[
                  { value: "all", label: "Todas" },
                  { value: "manual", label: "Manual" },
                  { value: "whatsapp", label: "WhatsApp" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("reconStatus") ? (
            <Field label="Situação da linha">
              <SearchSelect
                value={filters.reconStatus}
                onValueChange={(v) =>
                  patch({
                    reconStatus: v as ReportFilterState["reconStatus"],
                  })
                }
                options={[
                  { value: "all", label: "Todas" },
                  { value: "unmatched", label: "A conciliar" },
                  { value: "matched", label: "Conciliado" },
                  { value: "ignored", label: "Ignorado" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("dreView") ? (
            <Field label="Visão">
              <SearchSelect
                value={filters.dreView}
                onValueChange={(v) =>
                  patch({ dreView: v as ReportFilterState["dreView"] })
                }
                options={[
                  { value: "resumo", label: "Resumo" },
                  { value: "linhas", label: "Com categorias" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("stockMode") ? (
            <Field label="Recorte">
              <SearchSelect
                value={filters.stockMode}
                onValueChange={(v) =>
                  patch({ stockMode: v as ReportFilterState["stockMode"] })
                }
                options={[
                  { value: "filtered", label: "Com filtros atuais" },
                  { value: "all", label: "Todos os produtos" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("cmvPeriod") ? (
            <Field label="Período">
              <SearchSelect
                value={filters.cmvPeriod}
                onValueChange={(v) =>
                  patch({ cmvPeriod: v as ReportFilterState["cmvPeriod"] })
                }
                options={[
                  { value: "today", label: "Hoje" },
                  { value: "last7", label: "Esta semana" },
                  { value: "month", label: "Este mês" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("movementDirection") ? (
            <Field label="Tipo de movimento">
              <SearchSelect
                value={filters.movementDirection}
                onValueChange={(v) =>
                  patch({
                    movementDirection:
                      v as ReportFilterState["movementDirection"],
                  })
                }
                options={[
                  { value: "all", label: "Todos" },
                  { value: "in", label: "Entradas" },
                  { value: "out", label: "Saídas" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          {filterSet.has("scenario") ? (
            <Field label="Cenário">
              <SearchSelect
                value={filters.scenario}
                onValueChange={(v) =>
                  patch({ scenario: v as ReportFilterState["scenario"] })
                }
                options={[
                  { value: "base", label: "Base" },
                  { value: "optimistic", label: "Otimista" },
                  { value: "pessimistic", label: "Pessimista" },
                ]}
                triggerClassName="w-full"
              />
            </Field>
          ) : null}

          <Field label="Formato">
            <SearchSelect
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              options={[
                { value: "xlsx", label: "Excel (.xlsx)" },
                { value: "csv", label: "CSV" },
                { value: "pdf", label: "PDF" },
              ]}
              triggerClassName="w-full"
            />
          </Field>
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleGenerate()} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando…
              </>
            ) : (
              "Gerar arquivo"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

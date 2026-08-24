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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
              <Select
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
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Select
                value={filters.dateField}
                onValueChange={(v) =>
                  patch({ dateField: v as ReportFilterState["dateField"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="due_date">Vencimento (competência)</SelectItem>
                  <SelectItem value="paid_at">Pagamento (caixa)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("openDueBucket") ? (
            <Field label="Situação">
              <Select
                value={filters.openDueBucket}
                onValueChange={(v) =>
                  patch({
                    openDueBucket: v as ReportFilterState["openDueBucket"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas em aberto</SelectItem>
                  <SelectItem value="overdue">Somente vencidas</SelectItem>
                  <SelectItem value="upcoming">Somente a vencer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("flowType") ? (
            <Field label="Tipo">
              <Select
                value={filters.flowType}
                onValueChange={(v) =>
                  patch({ flowType: v as ReportFilterState["flowType"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Pagar e receber</SelectItem>
                  <SelectItem value="payable">Somente a pagar</SelectItem>
                  <SelectItem value="receivable">Somente a receber</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("situation") ? (
            <Field label="Quitação">
              <Select
                value={filters.situation}
                onValueChange={(v) =>
                  patch({ situation: v as ReportFilterState["situation"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="pending">Em aberto</SelectItem>
                  <SelectItem value="paid">Pagas / recebidas</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("basis") ? (
            <Field label="Base">
              <Select
                value={filters.basis}
                onValueChange={(v) =>
                  patch({ basis: v as ReportFilterState["basis"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="competencia">Competência (vencimento)</SelectItem>
                  <SelectItem value="caixa">Caixa (pagamento)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("natureza") ? (
            <Field label="Natureza">
              <Select
                value={filters.natureza}
                onValueChange={(v) =>
                  patch({ natureza: v as ReportFilterState["natureza"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="RECEITA">Receita</SelectItem>
                  <SelectItem value="DESPESA">Despesa</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("category") ? (
            <Field label="Categoria">
              <Select
                value={filters.categoryId}
                onValueChange={(v) => patch({ categoryId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("supplier") ? (
            <Field label="Fornecedor">
              <Select
                value={filters.supplierId}
                onValueChange={(v) => patch({ supplierId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("bankAccount") ? (
            <Field label="Conta bancária">
              <Select
                value={filters.bankAccountId}
                onValueChange={(v) => patch({ bankAccountId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Select
                value={filters.expenseStatus}
                onValueChange={(v) =>
                  patch({
                    expenseStatus: v as ReportFilterState["expenseStatus"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="approved">Aprovada</SelectItem>
                  <SelectItem value="rejected">Rejeitada</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("expenseOrigin") ? (
            <Field label="Origem">
              <Select
                value={filters.expenseOrigin}
                onValueChange={(v) =>
                  patch({
                    expenseOrigin: v as ReportFilterState["expenseOrigin"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("reconStatus") ? (
            <Field label="Situação da linha">
              <Select
                value={filters.reconStatus}
                onValueChange={(v) =>
                  patch({
                    reconStatus: v as ReportFilterState["reconStatus"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="unmatched">A conciliar</SelectItem>
                  <SelectItem value="matched">Conciliado</SelectItem>
                  <SelectItem value="ignored">Ignorado</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("dreView") ? (
            <Field label="Visão">
              <Select
                value={filters.dreView}
                onValueChange={(v) =>
                  patch({ dreView: v as ReportFilterState["dreView"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resumo">Resumo</SelectItem>
                  <SelectItem value="linhas">Com categorias</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("stockMode") ? (
            <Field label="Recorte">
              <Select
                value={filters.stockMode}
                onValueChange={(v) =>
                  patch({ stockMode: v as ReportFilterState["stockMode"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="filtered">Com filtros atuais</SelectItem>
                  <SelectItem value="all">Todos os produtos</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("cmvPeriod") ? (
            <Field label="Período">
              <Select
                value={filters.cmvPeriod}
                onValueChange={(v) =>
                  patch({ cmvPeriod: v as ReportFilterState["cmvPeriod"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="last7">Esta semana</SelectItem>
                  <SelectItem value="month">Este mês</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("movementDirection") ? (
            <Field label="Tipo de movimento">
              <Select
                value={filters.movementDirection}
                onValueChange={(v) =>
                  patch({
                    movementDirection:
                      v as ReportFilterState["movementDirection"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="in">Entradas</SelectItem>
                  <SelectItem value="out">Saídas</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {filterSet.has("scenario") ? (
            <Field label="Cenário">
              <Select
                value={filters.scenario}
                onValueChange={(v) =>
                  patch({ scenario: v as ReportFilterState["scenario"] })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="base">Base</SelectItem>
                  <SelectItem value="optimistic">Otimista</SelectItem>
                  <SelectItem value="pessimistic">Pessimista</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field label="Formato">
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
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

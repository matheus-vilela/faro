import { CreateSupplierSheet } from "@/components/CreateSupplierSheet";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Supplier } from "@/types/supplier";
import {
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  Link2,
  Pencil,
  Plus,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const ACCOUNT_TYPES = [
  { value: "conta_corrente", label: "Conta corrente" },
  { value: "poupanca", label: "Poupança" },
];

const PIX_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatória" },
];

export function Fornecedores() {
  const { currentCompany } = useCompany();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersCount, setSuppliersCount] = useState(0);
  const [suppliersPage, setSuppliersPage] = useState(1);
  const [suppliersSearch, setSuppliersSearch] = useState("");
  const debouncedSearch = useDebounce(suppliersSearch, 300);
  const [loading, setLoading] = useState(true);
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);

  // Sheet conta de pagamento
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState("conta_corrente");
  const [pixKey, setPixKey] = useState("");
  const [pixType, setPixType] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);

  // Sheet detalhe do fornecedor
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Dialog gerar link
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkSupplier, setLinkSupplier] = useState<Supplier | null>(null);
  const [generatedLink, setGeneratedLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);

  const fetchSuppliers = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    let query = supabase
      .from("suppliers")
      .select(
        `
        *,
        supplier_payment_info (*)
      `,
        { count: "exact" },
      )
      .eq("company_id", currentCompany.id)
      .order("name");
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      query = query.or(
        `name.ilike.${term},document.ilike.${term},email.ilike.${term}`,
      );
    }
    const { data, count } = await query.range(
      (suppliersPage - 1) * PAGE_SIZE,
      suppliersPage * PAGE_SIZE - 1,
    );
    const list = (data ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      payment_info: Array.isArray(s.supplier_payment_info)
        ? s.supplier_payment_info[0]
        : s.supplier_payment_info,
    }));
    setSuppliers(list as Supplier[]);
    setSuppliersCount(count ?? 0);
    setLoading(false);
  }, [currentCompany, debouncedSearch, suppliersPage]);

  useEffect(() => {
    queueMicrotask(() => setSuppliersPage(1));
  }, [debouncedSearch]);

  useEffect(() => {
    queueMicrotask(() => void fetchSuppliers());
  }, [fetchSuppliers]);

  const openPaymentDialog = (s: Supplier) => {
    setPaymentSupplier(s);
    const pi = s.payment_info;
    setBankName(pi?.bank_name ?? "");
    setBankCode(pi?.bank_code ?? "");
    setAgency(pi?.agency ?? "");
    setAccount(pi?.account ?? "");
    setAccountType(pi?.account_type ?? "conta_corrente");
    setPixKey(pi?.pix_key ?? "");
    setPixType(pi?.pix_type ?? "");
    setPaymentSheetOpen(true);
  };

  const handleSavePayment = async () => {
    if (!paymentSupplier) return;
    setPaymentSaving(true);
    const pi = paymentSupplier.payment_info;
    if (pi?.id) {
      await supabase
        .from("supplier_payment_info")
        .update({
          bank_name: bankName.trim() || null,
          bank_code: bankCode.trim() || null,
          agency: agency.trim() || null,
          account: account.trim() || null,
          account_type: accountType,
          pix_key: pixKey.trim() || null,
          pix_type: pixType || null,
        })
        .eq("id", pi.id);
    } else {
      await supabase.from("supplier_payment_info").insert({
        supplier_id: paymentSupplier.id,
        bank_name: bankName.trim() || null,
        bank_code: bankCode.trim() || null,
        agency: agency.trim() || null,
        account: account.trim() || null,
        account_type: accountType,
        pix_key: pixKey.trim() || null,
        pix_type: pixType || null,
      });
    }
    setPaymentSaving(false);
    setPaymentSheetOpen(false);
    fetchSuppliers();
  };

  const openLinkDialog = async (s: Supplier, invalidatePrevious = false) => {
    setLinkSupplier(s);
    setGeneratedLink("");
    setLinkDialogOpen(true);
    setLinkGenerating(true);
    if (invalidatePrevious) {
      await supabase
        .from("supplier_update_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("supplier_id", s.id)
        .is("used_at", null);
    }
    const { data } = await supabase
      .from("supplier_update_tokens")
      .insert({ supplier_id: s.id })
      .select("token")
      .single();
    setLinkGenerating(false);
    if (data?.token) {
      setGeneratedLink(
        `${window.location.origin}/atualizar-pagamento/${data.token}`,
      );
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleGenerateNewLink = async () => {
    if (!linkSupplier) return;
    setLinkGenerating(true);
    await supabase
      .from("supplier_update_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("supplier_id", linkSupplier.id)
      .is("used_at", null);
    const { data } = await supabase
      .from("supplier_update_tokens")
      .insert({ supplier_id: linkSupplier.id })
      .select("token")
      .single();
    setLinkGenerating(false);
    if (data?.token) {
      setGeneratedLink(
        `${window.location.origin}/atualizar-pagamento/${data.token}`,
      );
      setLinkCopied(false);
    }
  };

  const hasPaymentInfo = (s: Supplier) =>
    s.payment_info && (s.payment_info.bank_name || s.payment_info.pix_key);

  const openDetail = (s: Supplier) => {
    setDetailSupplier(s);
    setDetailEditMode(false);
    setEditName(s.name);
    setEditDocument(s.document ? maskCpfCnpj(s.document) : "");
    setEditEmail(s.email ?? "");
    setEditPhone(s.phone ? maskPhone(s.phone) : "");
    setEditNotes(s.notes ?? "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailSupplier) return;
    setEditSaving(true);
    await supabase
      .from("suppliers")
      .update({
        name: editName.trim(),
        document: editDocument.replace(/\D/g, "") || null,
        email: editEmail.trim() || null,
        phone: editPhone.replace(/\D/g, "") || null,
        notes: editNotes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detailSupplier.id);
    setEditSaving(false);
    setDetailEditMode(false);
    fetchSuppliers();
    setDetailSupplier((prev) =>
      prev
        ? {
            ...prev,
            name: editName.trim(),
            document: editDocument.replace(/\D/g, "") || null,
            email: editEmail.trim() || null,
            phone: editPhone.replace(/\D/g, "") || null,
            notes: editNotes.trim() || null,
          }
        : null,
    );
  };

  return (
    <PageShell className="space-y-8" narrow>
      <PageHeader
        title="Fornecedores"
        description="Cadastre fornecedores e gerencie as informações de pagamento"
        action={
          <Button
            type="button"
            onClick={() => setSupplierSheetOpen(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo fornecedor
          </Button>
        }
      />

      {currentCompany?.id && (
        <CreateSupplierSheet
          open={supplierSheetOpen}
          onOpenChange={setSupplierSheetOpen}
          companyId={currentCompany.id}
          onSuccess={() => fetchSuppliers()}
        />
      )}

      <Card>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Filtrar por nome, documento ou e-mail..."
              value={suppliersSearch}
              onChange={(e) => setSuppliersSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : suppliers.length === 0 ? (
            <p className="text-muted-foreground">
              Nenhum fornecedor cadastrado
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {suppliers.map((s) => {
                const hasPay = hasPaymentInfo(s);
                const metaParts: string[] = [];
                if (s.document?.trim()) {
                  metaParts.push(maskCpfCnpj(s.document));
                }
                if (s.email?.trim()) {
                  metaParts.push(s.email.trim());
                }
                if (s.phone?.trim()) {
                  metaParts.push(maskPhone(s.phone));
                }
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(s)}
                    onKeyDown={(e) => e.key === "Enter" && openDetail(s)}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-border px-3 py-3.5 text-left transition-colors last:border-b-0 sm:gap-4 sm:px-4",
                      "cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 text-muted-foreground",
                        // hasPay &&
                        //   "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-400",
                      )}
                      aria-hidden
                    >
                      <Truck className="h-5 w-5" strokeWidth={1.75} />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="font-medium leading-snug text-foreground">
                        {s.name}
                      </span>
                      {metaParts.length > 0 ? (
                        <p className="text-xs text-muted-foreground wrap-anywhere">
                          {metaParts.join(" · ")}
                        </p>
                      ) : (
                        <p className="text-xs italic text-muted-foreground/90">
                          Sem CPF/CNPJ, e-mail ou telefone
                        </p>
                      )}
                    </div>

                    <div
                      className="flex shrink-0 items-center gap-1 sm:gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-lg"
                        onClick={() => openPaymentDialog(s)}
                        title={
                          hasPay
                            ? "Editar conta de pagamento"
                            : "Inserir conta de pagamento"
                        }
                      >
                        <CreditCard
                          className={cn(
                            "h-4 w-4",
                            hasPay
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-500",
                          )}
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-lg"
                        onClick={() => openLinkDialog(s)}
                        title="Gerar link para o fornecedor atualizar"
                      >
                        <Link2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <ChevronRight
                      className="hidden h-4 w-4 shrink-0 text-muted-foreground/70 sm:block sm:h-5 sm:w-5"
                      aria-hidden
                    />
                  </div>
                );
              })}
            </div>
          )}
          {!loading && (
            <Pagination
              page={suppliersPage}
              totalCount={suppliersCount}
              onPageChange={setSuppliersPage}
            />
          )}
        </CardContent>
      </Card>

      {/* Sheet inserir/editar conta */}
      <Sheet open={paymentSheetOpen} onOpenChange={setPaymentSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Conta de pagamento</SheetTitle>
            <SheetDescription>
              {paymentSupplier?.name} — informe os dados bancários ou PIX
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Banco</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Nome do banco"
                />
              </div>
              <div>
                <Label>Código do banco</Label>
                <Input
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  placeholder="001"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Agência</Label>
                <Input
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="0000"
                />
              </div>
              <div>
                <Label>Conta</Label>
                <Input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="00000-0"
                />
              </div>
            </div>
            <div>
              <Label>Tipo de conta</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium">PIX</Label>
              <div className="flex gap-2 mt-2">
                <div>
                  <Label className="text-xs">Tipo da chave</Label>
                  <Select value={pixType} onValueChange={setPixType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Chave PIX</Label>
                  <Input
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="Chave PIX"
                  />
                </div>
              </div>
            </div>
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setPaymentSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button onClick={handleSavePayment} disabled={paymentSaving}>
              {paymentSaving ? "Salvando..." : "Salvar"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Dialog gerar link */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link para fornecedor atualizar dados</DialogTitle>
            <DialogDescription>
              Envie este link ao fornecedor {linkSupplier?.name}. O link é
              válido para uma única atualização e expira em 7 dias.
            </DialogDescription>
          </DialogHeader>
          {linkGenerating ? (
            <p className="text-muted-foreground">Gerando link...</p>
          ) : generatedLink ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={generatedLink}
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={handleCopyLink}>
                  {linkCopied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleGenerateNewLink}
              >
                Gerar novo link
              </Button>
              <p className="text-xs text-muted-foreground">
                Ao gerar um novo link, o anterior deixa de ser válido.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Sheet resumo do fornecedor */}
      <Sheet
        open={!!detailSupplier}
        onOpenChange={(o) => {
          if (!o) {
            setDetailSupplier(null);
            setDetailEditMode(false);
          }
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {detailSupplier && (
            <>
              <SheetHeader className="pl-0">
                <div className="flex items-center justify-between pr-8">
                  <SheetTitle className="flex items-center gap-2 text-lg">
                    <Truck className="h-5 w-5" />
                    {detailEditMode
                      ? "Editar fornecedor"
                      : "Dados do fornecedor"}
                  </SheetTitle>
                  {!detailEditMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailEditMode(true)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                  )}
                </div>
                <SheetDescription>{detailSupplier.name}</SheetDescription>
              </SheetHeader>
              {detailEditMode ? (
                <form onSubmit={handleSaveEdit} className="space-y-4 py-6">
                  <div>
                    <Label>Nome</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nome do fornecedor"
                      required
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label>CNPJ/CPF</Label>
                    <Input
                      value={editDocument}
                      onChange={(e) =>
                        setEditDocument(maskCpfCnpj(e.target.value))
                      }
                      placeholder="000.000.000-00"
                      className="mt-2"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>E-mail</Label>
                      <Input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="email@exemplo.com"
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>Telefone</Label>
                      <Input
                        value={editPhone}
                        onChange={(e) =>
                          setEditPhone(maskPhone(e.target.value))
                        }
                        placeholder="(11) 99999-9999"
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Input
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Opcional"
                      className="mt-2"
                    />
                  </div>
                  <SheetFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDetailEditMode(false)}
                      disabled={editSaving}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={editSaving}>
                      {editSaving ? "Salvando..." : "Salvar"}
                    </Button>
                  </SheetFooter>
                </form>
              ) : (
                <div className="space-y-6 py-6">
                  <div className="grid gap-4 text-sm">
                    {detailSupplier.document && (
                      <div>
                        <span className="text-muted-foreground">CNPJ/CPF:</span>{" "}
                        {maskCpfCnpj(detailSupplier.document)}
                      </div>
                    )}
                    {detailSupplier.email && (
                      <div>
                        <span className="text-muted-foreground">E-mail:</span>{" "}
                        {detailSupplier.email}
                      </div>
                    )}
                    {detailSupplier.phone && (
                      <div>
                        <span className="text-muted-foreground">Telefone:</span>{" "}
                        {maskPhone(detailSupplier.phone)}
                      </div>
                    )}
                    {detailSupplier.notes && (
                      <div>
                        <span className="text-muted-foreground">Obs:</span>{" "}
                        {detailSupplier.notes}
                      </div>
                    )}
                  </div>
                  {detailSupplier.payment_info && (
                    <div>
                      <p className="font-medium mb-2 flex items-center gap-2">
                        <CreditCard className="h-4 w-4" />
                        Conta de pagamento
                      </p>
                      <div className="rounded-lg border p-4 space-y-2 text-sm">
                        {detailSupplier.payment_info.bank_name && (
                          <p>
                            Banco: {detailSupplier.payment_info.bank_name}
                            {detailSupplier.payment_info.bank_code && (
                              <> ({detailSupplier.payment_info.bank_code})</>
                            )}
                          </p>
                        )}
                        {(detailSupplier.payment_info.agency ||
                          detailSupplier.payment_info.account) && (
                          <p>
                            Agência: {detailSupplier.payment_info.agency || "—"}{" "}
                            • Conta:{" "}
                            {detailSupplier.payment_info.account || "—"}
                          </p>
                        )}
                        {detailSupplier.payment_info.pix_key && (
                          <p>PIX: {detailSupplier.payment_info.pix_key}</p>
                        )}
                        {!detailSupplier.payment_info.bank_name &&
                          !detailSupplier.payment_info.pix_key && (
                            <p className="text-muted-foreground">
                              Nenhum dado cadastrado
                            </p>
                          )}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openPaymentDialog(detailSupplier)}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Conta de pagamento
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openLinkDialog(detailSupplier)}
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      Gerar link
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

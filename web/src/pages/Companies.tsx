import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import type { Company } from "@/contexts/CompanyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import {
  hasDuplicateUnitNameInGroup,
  mapCompanyUnitMutationError,
} from "@/lib/companyUnitName";
import { maskCep, maskCpfCnpj, maskPhone, unmask } from "@/lib/masks";
import { ROLE_LABELS } from "@/lib/roles";
import {
  validateStep1Empresa,
  validateStep3FocusNfe,
} from "@/lib/setup/validation";
import { supabase } from "@/lib/supabase";
import type { CompanyGroup } from "@/types/companyGroup";
import type {
  CertificateUploadStatus,
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusNfeMap,
} from "@/types/companySetup";
import {
  FOCUS_NFE_MODELO_NFCE,
  FOCUS_NFE_MODELO_NFE,
  REGIME_TRIBUTARIO_OPTIONS,
} from "@/types/companySetup";
import { Building2, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const CERTIFICATE_STATUS_OPTIONS: {
  value: CertificateUploadStatus;
  label: string;
}[] = [
  { value: "not_sent", label: "Não enviado" },
  { value: "uploaded", label: "Enviado" },
  { value: "validating", label: "Validando" },
  { value: "valid", label: "Válido" },
  { value: "invalid", label: "Inválido" },
];

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function Companies() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gestao = searchParams.get("gestao") === "1";

  const { user } = useAuth();
  const {
    groupsWithCompanies,
    currentCompany,
    setCurrentCompany,
    refetchCompanies,
    loading: companiesLoading,
  } = useCompany();
  const { openModal } = useUnitSetupModal();

  useEffect(() => {
    if (
      !gestao &&
      !companiesLoading &&
      groupsWithCompanies.length > 0 &&
      currentCompany
    ) {
      navigate("/app", { replace: true });
    }
  }, [
    gestao,
    companiesLoading,
    groupsWithCompanies.length,
    currentCompany,
    navigate,
  ]);

  const [renameGroup, setRenameGroup] = useState<CompanyGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    company: Company;
    groupName: string;
  } | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editName, setEditName] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editEmpresa, setEditEmpresa] = useState<EmpresaMap>({});
  const [editEndereco, setEditEndereco] = useState<EnderecoPrincipalMap>({});
  const [editFocus, setEditFocus] = useState<FocusNfeMap>({});
  const [editCertificateStatus, setEditCertificateStatus] =
    useState<CertificateUploadStatus>("not_sent");
  const [editSectionsOpen, setEditSectionsOpen] = useState({
    empresa: true,
    endereco: false,
    fiscal: false,
    certificado: false,
  });

  const toggleEditSection = (
    section: "empresa" | "endereco" | "fiscal" | "certificado",
    open: boolean,
  ) => {
    if (!open) {
      setEditSectionsOpen((prev) => ({ ...prev, [section]: false }));
      return;
    }
    setEditSectionsOpen({
      empresa: section === "empresa",
      endereco: section === "endereco",
      fiscal: section === "fiscal",
      certificado: section === "certificado",
    });
  };

  const [renameValue, setRenameValue] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGroupOwner = (g: CompanyGroup) =>
    !!user && g.owner_user_id === user.id;

  const handleSelectCompany = (company: Company) => {
    setCurrentCompany(company);
    navigate("/app", { replace: true });
  };

  const handleRenameGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameGroup) return;
    setLoading(true);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("company_groups")
        .update({ name: renameValue.trim() })
        .eq("id", renameGroup.id);
      if (uErr) throw uErr;
      await refetchCompanies();
      setRenameGroup(null);
      setRenameValue("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao renomear grupo");
    } finally {
      setLoading(false);
    }
  };

  const openEditCompany = (company: Company) => {
    const empresaRaw = asObj(company.empresa);
    const enderecoRaw = asObj(company.endereco_principal);
    const focusRaw = asObj(company.focusnfe);
    const setupRaw = asObj(company.setup);
    const certRaw = asObj(setupRaw.certificate);

    const empresaMap: EmpresaMap = {
      nome_razao_social:
        (empresaRaw.nome_razao_social as string | undefined) ?? company.name,
      nome_fantasia:
        (empresaRaw.nome_fantasia as string | undefined) ?? company.name,
      cnpj_cpf:
        (empresaRaw.cnpj_cpf as string | undefined) ?? (company.document ?? ""),
      inscricao_estadual:
        (empresaRaw.inscricao_estadual as string | undefined) ?? "",
      regime_tributario:
        (empresaRaw.regime_tributario as number | undefined) ?? undefined,
      email: (empresaRaw.email as string | undefined) ?? (company.email ?? ""),
      telefone:
        (empresaRaw.telefone as string | undefined) ?? (company.phone ?? ""),
      photo_base64: (empresaRaw.photo_base64 as string | undefined) ?? undefined,
    };

    const enderecoMap: EnderecoPrincipalMap = {
      cep: (enderecoRaw.cep as string | undefined) ?? "",
      logradouro: (enderecoRaw.logradouro as string | undefined) ?? "",
      numero: (enderecoRaw.numero as string | undefined) ?? "",
      complemento: (enderecoRaw.complemento as string | undefined) ?? "",
      bairro: (enderecoRaw.bairro as string | undefined) ?? "",
      municipio: (enderecoRaw.municipio as string | undefined) ?? "",
      uf: (enderecoRaw.uf as string | undefined) ?? "",
      ibge_cidade: (enderecoRaw.ibge_cidade as string | undefined) ?? "",
    };

    const focusMap: FocusNfeMap = {
      modelo: (focusRaw.modelo as string | undefined) ?? "",
      csc_nfce_producao:
        (focusRaw.csc_nfce_producao as string | undefined) ?? "",
      id_token_nfce_producao:
        (focusRaw.id_token_nfce_producao as string | undefined) ?? "",
      csc_nfce_homologacao:
        (focusRaw.csc_nfce_homologacao as string | undefined) ?? "",
      id_token_nfce_homologacao:
        (focusRaw.id_token_nfce_homologacao as string | undefined) ?? "",
      serie: (focusRaw.serie as string | undefined) ?? "",
      proximoNumeroNfce:
        (focusRaw.proximoNumeroNfce as string | undefined) ?? "",
      certificado_ativo:
        (focusRaw.certificado_ativo as boolean | undefined) ?? false,
      certificado_validade:
        (focusRaw.certificado_validade as string | undefined) ?? "",
      token_homologacao:
        (focusRaw.token_homologacao as string | undefined) ?? "",
      token_producao: (focusRaw.token_producao as string | undefined) ?? "",
      id_empresa: (focusRaw.id_empresa as number | undefined) ?? undefined,
    };

    setEditingCompany(company);
    setEditEmpresa(empresaMap);
    setEditEndereco(enderecoMap);
    setEditFocus(focusMap);
    setEditName(empresaMap.nome_fantasia ?? company.name);
    setEditDocument(maskCpfCnpj(empresaMap.cnpj_cpf ?? ""));
    setEditEmail(empresaMap.email ?? "");
    setEditCertificateStatus(
      ((certRaw.status as CertificateUploadStatus | undefined) ?? "not_sent"),
    );
    setEditSectionsOpen({
      empresa: true,
      endereco: false,
      fiscal: false,
      certificado: false,
    });
    setError(null);
  };

  const handleUpdateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany) return;
    const docDigits = unmask(editDocument);
    const phoneDigits = unmask(editEmpresa.telefone ?? "");

    const nextEmpresa: EmpresaMap = {
      ...editEmpresa,
      nome_fantasia: editName.trim(),
      cnpj_cpf: docDigits,
      email: editEmail.trim(),
      telefone: phoneDigits,
    };

    const step1Validation = validateStep1Empresa(nextEmpresa);
    if (step1Validation) {
      setError(step1Validation);
      return;
    }

    const step3Validation = validateStep3FocusNfe(editFocus);
    if (step3Validation) {
      setError(step3Validation);
      return;
    }

    const trimmedName =
      nextEmpresa.nome_fantasia?.trim() ||
      nextEmpresa.nome_razao_social?.trim() ||
      "";
    if (!trimmedName) {
      setError("Informe o nome da unidade.");
      return;
    }
    const gwcEdit = groupsWithCompanies.find(
      (g) => g.group.id === editingCompany.group_id,
    );
    if (
      hasDuplicateUnitNameInGroup(
        trimmedName,
        editingCompany.group_id,
        gwcEdit?.companies ?? [],
        editingCompany.id,
      )
    ) {
      setError("Já existe uma unidade com este nome neste grupo.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const setupRaw = asObj(editingCompany.setup);
      const currentSetupCertificate = asObj(setupRaw.certificate);
      const nextSetup = {
        ...setupRaw,
        certificate: {
          ...currentSetupCertificate,
          status: editCertificateStatus,
          updated_at: new Date().toISOString(),
        },
      };

      const { error: uErr } = await supabase
        .from("companies")
        .update({
          name: trimmedName,
          document: docDigits,
          email: nextEmpresa.email?.trim() || null,
          phone: phoneDigits || null,
          empresa: {
            ...nextEmpresa,
            cnpj_cpf: docDigits,
            telefone: phoneDigits,
          },
          endereco_principal: editEndereco,
          focusnfe: {
            ...editFocus,
            certificado_ativo: editCertificateStatus === "valid",
          },
          setup: nextSetup,
        })
        .eq("id", editingCompany.id);
      if (uErr) throw uErr;
      await refetchCompanies();
      setEditingCompany(null);
      setEditName("");
      setEditDocument("");
      setEditEmail("");
      setEditEmpresa({});
      setEditEndereco({});
      setEditFocus({});
      setEditCertificateStatus("not_sent");
    } catch (err: unknown) {
      setError(mapCompanyUnitMutationError(err, "Erro ao atualizar unidade"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!deleteTarget) return;
    setLoading(true);
    setError(null);
    try {
      const { error: dErr } = await supabase
        .from("companies")
        .delete()
        .eq("id", deleteTarget.company.id);
      if (dErr) throw dErr;
      await refetchCompanies();
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao remover unidade");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  if (companiesLoading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">
          Carregando empresas...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PageShell className="max-w-2xl space-y-6 pb-0">
        <PageHeader
          className="flex-col items-center text-center sm:flex-col sm:items-center"
          title="Grupos e unidades"
          description="Cada grupo reúne uma ou mais empresas (unidades)."
          icon={Building2}
        />

        <div className="grid gap-6">
          {groupsWithCompanies.map(({ group, companies: ucs }) => {
            const owner = isGroupOwner(group);
            return (
              <Card key={group.id}>
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-lg">{group.name}</CardTitle>
                        {owner && (
                          <CardDescription>
                            Você é o dono deste grupo
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    {owner && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRenameGroup(group);
                            setRenameValue(group.name);
                            setError(null);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          Renomear grupo
                        </Button>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => {
                            openModal({ kind: "add_unit", groupId: group.id });
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Nova unidade
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 pt-1">
                    {ucs.map(({ company, role }) => (
                      <div
                        key={company.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2"
                      >
                        <button
                          type="button"
                          className="flex flex-1 min-w-0 flex-col items-start text-left hover:opacity-80"
                          onClick={() => handleSelectCompany(company)}
                        >
                          <span className="font-medium truncate">
                            {company.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ROLE_LABELS[role]}
                          </span>
                          {company.document && (
                            <span className="text-xs text-muted-foreground">
                              CNPJ: {maskCpfCnpj(company.document)}
                            </span>
                          )}
                        </button>
                        {owner && (
                          <div className="flex shrink-0 gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="shrink-0"
                                  aria-label="Editar unidade"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openEditCompany(company);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Editar</TooltipContent>
                            </Tooltip>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 text-destructive hover:text-destructive"
                              title="Remover unidade"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setDeleteTarget({
                                  company,
                                  groupName: group.name,
                                });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            onClick={() => openModal({ kind: "new_group" })}
            className="flex-1"
          >
            Novo grupo
          </Button>
          <Button
            variant="outline"
            onClick={() => supabase.auth.signOut()}
            className="flex-1"
          >
            Sair
          </Button>
        </div>
      </PageShell>

      <Sheet
        open={!!editingCompany}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCompany(null);
            setEditName("");
            setEditDocument("");
            setEditEmail("");
            setEditEmpresa({});
            setEditEndereco({});
            setEditFocus({});
            setEditCertificateStatus("not_sent");
            setEditSectionsOpen({
              empresa: true,
              endereco: false,
              fiscal: false,
              certificado: false,
            });
            setError(null);
          }
        }}
      >
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Editar unidade</SheetTitle>
            <SheetDescription>
              Edite os dados da unidade em blocos recolhíveis.
            </SheetDescription>
          </SheetHeader>
          <form
            onSubmit={handleUpdateUnit}
            className="space-y-4 py-4 max-h-[calc(100vh-10rem)] overflow-y-auto pr-1"
          >
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </p>
            )}
            <Collapsible
              open={editSectionsOpen.empresa}
              onOpenChange={(open) => toggleEditSection("empresa", open)}
              className="rounded-xl border bg-background shadow-sm"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
                <div>
                  <p className="font-medium">Dados da empresa</p>
                  <p className="text-xs text-muted-foreground">
                    Identificação e informações cadastrais principais.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${editSectionsOpen.empresa ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-4 pb-4 border-t bg-muted/10">
                <div className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label htmlFor="edit-razao">Razão social *</Label>
                <Input
                  id="edit-razao"
                  value={editEmpresa.nome_razao_social ?? ""}
                  onChange={(e) =>
                    setEditEmpresa((prev) => ({
                      ...prev,
                      nome_razao_social: e.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-unit-name">Nome fantasia *</Label>
                <Input
                  id="edit-unit-name"
                  placeholder="Nome do bar/restaurante"
                  value={editName}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditName(value);
                    setEditEmpresa((prev) => ({
                      ...prev,
                      nome_fantasia: value,
                    }));
                  }}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-document">CNPJ *</Label>
                <Input
                  id="edit-document"
                  placeholder="00.000.000/0001-00"
                  inputMode="numeric"
                  autoComplete="off"
                  value={editDocument}
                  onChange={(e) => {
                    const value = maskCpfCnpj(e.target.value);
                    setEditDocument(value);
                    setEditEmpresa((prev) => ({
                      ...prev,
                      cnpj_cpf: unmask(value),
                    }));
                  }}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ie">Inscrição estadual</Label>
                <Input
                  id="edit-ie"
                  value={editEmpresa.inscricao_estadual ?? ""}
                  onChange={(e) =>
                    setEditEmpresa((prev) => ({
                      ...prev,
                      inscricao_estadual: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Regime tributário *</Label>
                <Select
                  value={
                    editEmpresa.regime_tributario != null
                      ? String(editEmpresa.regime_tributario)
                      : undefined
                  }
                  onValueChange={(v) =>
                    setEditEmpresa((prev) => ({
                      ...prev,
                      regime_tributario: Number(v),
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {REGIME_TRIBUTARIO_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email *</Label>
                <Input
                  id="edit-email"
                  type="email"
                  placeholder="contato@estabelecimento.com"
                  value={editEmail}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditEmail(value);
                    setEditEmpresa((prev) => ({ ...prev, email: value }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-tel">Telefone *</Label>
                <Input
                  id="edit-tel"
                  inputMode="tel"
                  value={maskPhone(editEmpresa.telefone ?? "")}
                  onChange={(e) =>
                    setEditEmpresa((prev) => ({
                      ...prev,
                      telefone: unmask(e.target.value),
                    }))
                  }
                />
              </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible
              open={editSectionsOpen.endereco}
              onOpenChange={(open) => toggleEditSection("endereco", open)}
              className="rounded-xl border bg-background shadow-sm"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
                <div>
                  <p className="font-medium">Endereço</p>
                  <p className="text-xs text-muted-foreground">
                    Localização e dados de correspondência da unidade.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${editSectionsOpen.endereco ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-4 pb-4 border-t bg-muted/10">
                <div className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label htmlFor="edit-cep">CEP</Label>
                <Input
                  id="edit-cep"
                  value={maskCep(editEndereco.cep ?? "")}
                  onChange={(e) =>
                    setEditEndereco((prev) => ({
                      ...prev,
                      cep: unmask(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-logradouro">Logradouro</Label>
                <Input
                  id="edit-logradouro"
                  value={editEndereco.logradouro ?? ""}
                  onChange={(e) =>
                    setEditEndereco((prev) => ({
                      ...prev,
                      logradouro: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-numero">Número</Label>
                  <Input
                    id="edit-numero"
                    value={editEndereco.numero ?? ""}
                    onChange={(e) =>
                      setEditEndereco((prev) => ({
                        ...prev,
                        numero: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-complemento">Complemento</Label>
                  <Input
                    id="edit-complemento"
                    value={editEndereco.complemento ?? ""}
                    onChange={(e) =>
                      setEditEndereco((prev) => ({
                        ...prev,
                        complemento: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-bairro">Bairro</Label>
                <Input
                  id="edit-bairro"
                  value={editEndereco.bairro ?? ""}
                  onChange={(e) =>
                    setEditEndereco((prev) => ({
                      ...prev,
                      bairro: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-municipio">Cidade</Label>
                  <Input
                    id="edit-municipio"
                    value={editEndereco.municipio ?? ""}
                    onChange={(e) =>
                      setEditEndereco((prev) => ({
                        ...prev,
                        municipio: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-uf">UF</Label>
                  <Input
                    id="edit-uf"
                    value={editEndereco.uf ?? ""}
                    maxLength={2}
                    onChange={(e) =>
                      setEditEndereco((prev) => ({
                        ...prev,
                        uf: e.target.value.toUpperCase().slice(0, 2),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ibge">IBGE da cidade</Label>
                <Input
                  id="edit-ibge"
                  value={editEndereco.ibge_cidade ?? ""}
                  onChange={(e) =>
                    setEditEndereco((prev) => ({
                      ...prev,
                      ibge_cidade: e.target.value,
                    }))
                  }
                />
              </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible
              open={editSectionsOpen.fiscal}
              onOpenChange={(open) => toggleEditSection("fiscal", open)}
              className="rounded-xl border bg-background shadow-sm"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
                <div>
                  <p className="font-medium">Dados fiscais</p>
                  <p className="text-xs text-muted-foreground">
                    Configurações de emissão fiscal e parâmetros da FocusNFe.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${editSectionsOpen.fiscal ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-4 pb-4 border-t bg-muted/10">
                <div className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label>Modelo da nota *</Label>
                <Select
                  value={editFocus.modelo ?? undefined}
                  onValueChange={(v) =>
                    setEditFocus((prev) => ({ ...prev, modelo: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione NFC-e ou NF-e" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value={FOCUS_NFE_MODELO_NFCE}>NFC-e</SelectItem>
                    <SelectItem value={FOCUS_NFE_MODELO_NFE}>NF-e</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-csc-prod">CSC NFC-e produção</Label>
                  <Input
                    id="edit-csc-prod"
                    value={editFocus.csc_nfce_producao ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        csc_nfce_producao: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-id-prod">ID token produção</Label>
                  <Input
                    id="edit-id-prod"
                    value={editFocus.id_token_nfce_producao ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        id_token_nfce_producao: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-csc-hom">CSC NFC-e homologação</Label>
                  <Input
                    id="edit-csc-hom"
                    value={editFocus.csc_nfce_homologacao ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        csc_nfce_homologacao: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-id-hom">ID token homologação</Label>
                  <Input
                    id="edit-id-hom"
                    value={editFocus.id_token_nfce_homologacao ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        id_token_nfce_homologacao: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-serie">Série</Label>
                  <Input
                    id="edit-serie"
                    value={editFocus.serie ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({ ...prev, serie: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-prox-num">Próximo número NFC-e</Label>
                  <Input
                    id="edit-prox-num"
                    value={editFocus.proximoNumeroNfce ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        proximoNumeroNfce: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-token-hom">Token homologação</Label>
                  <Input
                    id="edit-token-hom"
                    value={editFocus.token_homologacao ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        token_homologacao: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-token-prod">Token produção</Label>
                  <Input
                    id="edit-token-prod"
                    value={editFocus.token_producao ?? ""}
                    onChange={(e) =>
                      setEditFocus((prev) => ({
                        ...prev,
                        token_producao: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-id-empresa-focus">ID empresa FocusNFe</Label>
                <Input
                  id="edit-id-empresa-focus"
                  inputMode="numeric"
                  value={
                    editFocus.id_empresa != null ? String(editFocus.id_empresa) : ""
                  }
                  onChange={(e) =>
                    setEditFocus((prev) => ({
                      ...prev,
                      id_empresa: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    }))
                  }
                />
              </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible
              open={editSectionsOpen.certificado}
              onOpenChange={(open) => toggleEditSection("certificado", open)}
              className="rounded-xl border bg-background shadow-sm"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
                <div>
                  <p className="font-medium">Certificado digital</p>
                  <p className="text-xs text-muted-foreground">
                    Status e validade do certificado A1 para emissão fiscal.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${editSectionsOpen.certificado ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-4 pb-4 border-t bg-muted/10">
                <div className="space-y-3 pt-3">
              <div className="space-y-2">
                <Label>Status do certificado</Label>
                <Select
                  value={editCertificateStatus}
                  onValueChange={(v) =>
                    setEditCertificateStatus(v as CertificateUploadStatus)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o status" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    {CERTIFICATE_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cert-validade">
                  Validade do certificado
                </Label>
                <Input
                  id="edit-cert-validade"
                  type="date"
                  value={editFocus.certificado_validade ?? ""}
                  onChange={(e) =>
                    setEditFocus((prev) => ({
                      ...prev,
                      certificado_validade: e.target.value,
                    }))
                  }
                />
              </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingCompany(null);
                  setEditName("");
                  setEditDocument("");
                  setEditEmail("");
                  setEditEmpresa({});
                  setEditEndereco({});
                  setEditFocus({});
                  setEditCertificateStatus("not_sent");
                  setEditSectionsOpen({
                    empresa: true,
                    endereco: false,
                    fiscal: false,
                    certificado: false,
                  });
                  setError(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet
        open={!!renameGroup}
        onOpenChange={(open) => {
          if (!open) {
            setRenameGroup(null);
            setRenameValue("");
            setError(null);
          }
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Renomear grupo</SheetTitle>
            <SheetDescription>
              Apenas o dono pode alterar o nome do grupo.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleRenameGroup} className="space-y-4 py-4">
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="rename">Nome do grupo *</Label>
              <Input
                id="rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                required
              />
            </div>
            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRenameGroup(null);
                  setRenameValue("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover unidade?</DialogTitle>
            <DialogDescription>
              A unidade <strong>{deleteTarget?.company.name}</strong> do grupo{" "}
              <strong>{deleteTarget?.groupName}</strong> será excluída. Esta
              ação não pode ser desfeita se houver dados vinculados.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={loading}
              onClick={() => void handleDeleteCompany()}
            >
              {loading ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

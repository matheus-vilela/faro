import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Loader2,
  MessageCircle,
  PackageCheck,
  Share2,
} from "lucide-react";

/** Desktop columns for header + rows (parent grid; rows use subgrid). */
export const NOTAS_RECEBIMENTO_LIST_GRID =
  "md:grid md:grid-cols-[minmax(0,1fr)_max-content_max-content_max-content_max-content] md:gap-x-4";

export type RecebimentoBadgeInfo = {
  label: string;
  className: string;
};

export type NotasRecebimentoListRowProps = {
  id: string;
  displayTitle: string;
  invoiceNumber: string | null;
  typeLabel: string;
  statusLabel: string;
  competenceLabel: string;
  totalLabel: string;
  /** Tooltip com metadados secundários (CNPJ, categoria, etc.). */
  secondaryTitle?: string;
  boletoLinked: boolean;
  isHighlight?: boolean;
  pendingOwnerApproval?: boolean;
  /** WhatsApp aguardando aprovação do proprietário. */
  unapproved?: boolean;
  valueRisk?: boolean;
  valueRiskTitle?: string;
  unlinkedProducts?: number;
  recebimento: RecebimentoBadgeInfo;
  ensuringRecebimento?: boolean;
  showShareAction?: boolean;
  onOpenDetail: () => void;
  onOpenReview: () => void;
  onOpenShare: () => void;
  onBoletoClick: () => void;
};

export function NotasRecebimentoListRow({
  id,
  displayTitle,
  invoiceNumber,
  typeLabel,
  statusLabel,
  competenceLabel,
  totalLabel,
  secondaryTitle,
  boletoLinked,
  isHighlight,
  pendingOwnerApproval,
  unapproved,
  valueRisk,
  valueRiskTitle,
  unlinkedProducts = 0,
  recebimento,
  ensuringRecebimento,
  showShareAction,
  onOpenDetail,
  onOpenReview,
  onOpenShare,
  onBoletoClick,
}: NotasRecebimentoListRowProps) {
  const nfLine = invoiceNumber?.trim()
    ? `NF ${invoiceNumber.trim()}`
    : typeLabel;

  return (
    <div
      id={id}
      role="button"
      tabIndex={0}
      title={secondaryTitle}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className={cn(
        "group relative border-b border-l-[3px] outline-none transition-colors last:border-b-0",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "md:col-span-5 md:grid md:grid-cols-subgrid md:items-center md:px-4 md:py-2.5",
        unapproved
          ? "bg-amber-500/8 hover:bg-amber-500/14 focus-visible:bg-amber-500/14 dark:bg-amber-500/10 dark:hover:bg-amber-500/16"
          : "bg-card hover:bg-muted/40 focus-visible:bg-muted/40",
        boletoLinked
          ? "border-l-emerald-600/80"
          : "border-l-amber-500/55",
        isHighlight && "ring-1 ring-inset ring-primary/20",
      )}
    >
      <div className="hidden min-w-0 md:block">
        <p className="truncate text-sm font-semibold leading-tight tracking-tight">
          {displayTitle}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {nfLine}
          <span className="text-muted-foreground/50"> · </span>
          {statusLabel}
        </p>
      </div>

      <div className="hidden min-w-0 flex-wrap items-center gap-1 md:flex">
          <Badge
            variant="outline"
            className={cn("max-w-full truncate text-[10px] font-normal", recebimento.className)}
          >
            {recebimento.label}
          </Badge>
          {pendingOwnerApproval && (
            <Badge
              variant="outline"
              className="gap-0.5 border-amber-600/30 bg-amber-500/10 text-[10px] text-amber-950 dark:text-amber-100"
              title="Importação pelo WhatsApp — aguardando aprovação"
            >
              <MessageCircle className="h-3 w-3 shrink-0" aria-hidden />
              WhatsApp
            </Badge>
          )}
          {valueRisk && (
            <Badge
              variant="outline"
              className="border-destructive/35 bg-destructive/10 text-[10px] text-destructive"
              title={valueRiskTitle}
            >
              Valores
            </Badge>
          )}
          {unlinkedProducts > 0 && (
            <Badge
              variant="outline"
              className="border-violet-500/35 bg-violet-500/10 text-[10px] text-violet-900 dark:text-violet-100"
              title="Linhas sem produto vinculado ao estoque"
            >
              Produto
              {unlinkedProducts > 1 ? ` (${unlinkedProducts})` : ""}
            </Badge>
          )}
        </div>

        <p className="hidden whitespace-nowrap pl-8 text-right text-xs tabular-nums text-muted-foreground md:block">
          {competenceLabel}
        </p>

        <p className="hidden whitespace-nowrap pl-8 text-right text-sm font-semibold tabular-nums tracking-tight md:block">
          {totalLabel}
        </p>

        <div
          className="hidden items-center justify-end gap-0.5 pl-8 md:flex"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <RowIconButton
            label="Abrir revisão"
            disabled={ensuringRecebimento}
            onClick={onOpenReview}
          >
            {ensuringRecebimento ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PackageCheck className="h-4 w-4" />
            )}
          </RowIconButton>
          {showShareAction && (
            <RowIconButton
              label="Vincular operador"
              disabled={ensuringRecebimento}
              onClick={onOpenShare}
            >
              <Share2 className="h-4 w-4" />
            </RowIconButton>
          )}
          <RowIconButton
            label={boletoLinked ? "Ver boleto" : "Vincular boleto"}
            onClick={onBoletoClick}
            className={
              boletoLinked
                ? "text-emerald-700 hover:text-emerald-800 dark:text-emerald-300"
                : "text-destructive hover:text-destructive"
            }
          >
            <Banknote className="h-4 w-4" />
          </RowIconButton>
        </div>

      {/* Mobile: compact stacked card */}
      <div className="flex flex-col gap-2.5 px-3 py-3 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-snug">
              {displayTitle}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {nfLine}
              <span className="text-muted-foreground/50"> · </span>
              {competenceLabel}
            </p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums">
            {totalLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Badge
            variant="outline"
            className={cn("text-[10px] font-normal", recebimento.className)}
          >
            {recebimento.label}
          </Badge>
          {pendingOwnerApproval && (
            <Badge
              variant="outline"
              className="gap-0.5 border-amber-600/30 bg-amber-500/10 text-[10px]"
            >
              <MessageCircle className="h-3 w-3" aria-hidden />
              WhatsApp
            </Badge>
          )}
          {valueRisk && (
            <Badge
              variant="outline"
              className="border-destructive/35 bg-destructive/10 text-[10px] text-destructive"
            >
              Valores
            </Badge>
          )}
          {unlinkedProducts > 0 && (
            <Badge
              variant="outline"
              className="border-violet-500/35 bg-violet-500/10 text-[10px]"
            >
              Produto
              {unlinkedProducts > 1 ? ` (${unlinkedProducts})` : ""}
            </Badge>
          )}
        </div>

        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8 flex-1 text-xs"
            disabled={ensuringRecebimento}
            onClick={onOpenReview}
          >
            {ensuringRecebimento ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
            )}
            Revisão
          </Button>
          {showShareAction && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 flex-1 text-xs"
              disabled={ensuringRecebimento}
              onClick={onOpenShare}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Operador
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "h-8 flex-1 text-xs",
              boletoLinked
                ? "border-emerald-600/35 text-emerald-800 dark:text-emerald-200"
                : "border-destructive/35 text-destructive",
            )}
            onClick={onBoletoClick}
          >
            <Banknote className="mr-1.5 h-3.5 w-3.5" />
            Boleto
          </Button>
        </div>
      </div>
    </div>
  );
}

function RowIconButton({
  label,
  children,
  onClick,
  disabled,
  className,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={label}
          className={cn("h-8 w-8 text-muted-foreground", className)}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

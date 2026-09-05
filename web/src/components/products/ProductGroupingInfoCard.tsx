import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import { Badge } from "@/components/ui/badge";
import {
  groupingDetailTitle,
  listSaleFamilyForProduct,
  type SaleFamilyInfo,
  type SaleFamilyMember,
} from "@/lib/productSaleFamily";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";
import { useEffect, useState } from "react";

function formatQtyPerSale(qty: number | null | undefined): string | null {
  if (qty == null || !Number.isFinite(Number(qty))) return null;
  const n = Number(qty);
  const label = n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return `${label} por 1 venda`;
}

function MemberLine({
  member,
  highlight,
}: {
  member: SaleFamilyMember;
  highlight?: boolean;
}) {
  const qty = formatQtyPerSale(member.qty_per_sale);
  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-2",
        highlight ? "border-sky-500/40 bg-sky-500/10" : "bg-background",
      )}
    >
      <p className="truncate text-sm font-medium">{member.name}</p>
      <p className="truncate text-xs text-muted-foreground">
        {[member.sku ? `SKU ${member.sku}` : "sem SKU", qty]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </li>
  );
}

export function ProductGroupingInfoCard({
  companyId,
  productId,
  refreshKey = 0,
  className,
}: {
  companyId: string;
  productId: string;
  refreshKey?: number;
  className?: string;
}) {
  const [info, setInfo] = useState<SaleFamilyInfo | null>(null);
  const [members, setMembers] = useState<SaleFamilyMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const first = await listSaleFamilyForProduct(companyId, productId);
        if (cancelled) return;
        setInfo(first);
        if (first.kind === "variant" && first.family?.id) {
          const parent = await listSaleFamilyForProduct(
            companyId,
            first.family.id,
          );
          if (cancelled) return;
          setMembers(parent.members);
        } else {
          setMembers(first.members);
        }
      } catch {
        if (!cancelled) {
          setInfo(null);
          setMembers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, productId, refreshKey]);

  if (loading || !info || info.kind === "none") return null;

  const title = groupingDetailTitle(info.kind);
  const family = info.family;
  const qty =
    info.kind === "variant" ? formatQtyPerSale(family?.qty_per_sale) : null;
  const otherMembers = members.filter(
    (row) => row.variant_product_id !== productId,
  );

  return (
    <div className={cn(PRODUCT_SHEET_SECTION, className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Agrupamento
        </p>
        <Badge
          variant="secondary"
          className="gap-1 border-sky-500/40 bg-sky-500/10 font-normal text-sky-950 dark:text-sky-100"
        >
          <Layers className="h-3 w-3" />
          {title}
        </Badge>
      </div>

      {info.kind === "family" ? (
        <p className="text-sm text-muted-foreground">
          Item de cardápio. A venda gera receita e não baixa estoque neste SKU.
          A baixa vem das variantes no estoque do dia.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Continua sendo produto de estoque. A venda do agrupamento não baixa
          este SKU — a baixa vem do relatório do dia.
        </p>
      )}

      {info.kind === "variant" && family ? (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Agrupamento
            </dt>
            <dd className="mt-0.5 font-medium">{family.name}</dd>
          </div>
          {family.sku ? (
            <div>
              <dt className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                SKU
              </dt>
              <dd className="mt-0.5 font-mono text-xs">{family.sku}</dd>
            </div>
          ) : null}
          {qty ? (
            <div>
              <dt className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Proporção
              </dt>
              <dd className="mt-0.5">{qty}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {info.kind === "family" && family?.sku ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          SKU {family.sku}
        </p>
      ) : null}

      {info.kind === "family" ? (
        <div className="mt-4">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Produtos ligados
            {members.length > 0 ? ` (${members.length})` : ""}
          </p>
          {members.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nenhum produto ligado ainda. Use Configuração para incluir.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {members.map((member) => (
                <MemberLine key={member.id} member={member} />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {info.kind === "variant" && otherMembers.length > 0 ? (
        <div className="mt-4">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Outros produtos deste agrupamento
          </p>
          <ul className="mt-2 space-y-1.5">
            {otherMembers.map((member) => (
              <MemberLine key={member.id} member={member} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProductGroupingVariantBadge({
  companyId,
  productId,
  stockControlType,
}: {
  companyId: string;
  productId: string;
  stockControlType?: string | null;
}) {
  const [isVariant, setIsVariant] = useState(false);

  useEffect(() => {
    if (stockControlType === "SALE_FAMILY") {
      setIsVariant(false);
      return;
    }
    let cancelled = false;
    void listSaleFamilyForProduct(companyId, productId)
      .then((info) => {
        if (!cancelled) setIsVariant(info.kind === "variant");
      })
      .catch(() => {
        if (!cancelled) setIsVariant(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, productId, stockControlType]);

  if (!isVariant) return null;

  return (
    <Badge
      variant="secondary"
      className="gap-1 border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100"
    >
      <Layers className="h-3 w-3" />
      Faz parte de um agrupamento
    </Badge>
  );
}

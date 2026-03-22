import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;

interface PaginationProps {
  page: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  className?: string;
}

export function Pagination({
  page,
  totalCount,
  onPageChange,
  pageSize = PAGE_SIZE,
  className = "",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div
      className={`flex items-center justify-between gap-4 py-2 ${className}`}
    >
      <p className="text-sm text-muted-foreground">
        {totalCount === 0 ? (
          "Nenhum registro"
        ) : (
          <>
            Exibindo {from} a {to} de {totalCount}
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium min-w-[80px] text-center">
          Página {page} de {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export { PAGE_SIZE };

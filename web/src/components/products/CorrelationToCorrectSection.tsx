import { CorrelationCaseWorkbench } from "@/components/products/correlacao2/CorrelationCaseWorkbench";
import type { ProductSetupQueue } from "@/lib/productSetupQueue";
import type { ProductValidationResult } from "@/lib/productValidation/types";

export function CorrelationToCorrectSection({
  companyId,
  queue,
  result,
  onResolved,
}: {
  companyId: string;
  queue: ProductSetupQueue;
  result: ProductValidationResult | null;
  onResolved: (productId: string) => void;
}) {
  if (queue.items.length === 0) return null;

  return (
    <CorrelationCaseWorkbench
      companyId={companyId}
      queue={queue}
      result={result}
      onResolved={onResolved}
    />
  );
}

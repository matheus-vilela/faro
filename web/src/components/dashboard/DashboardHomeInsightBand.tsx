import { FaroTipBand } from "@/components/FaroTipBand";

export function DashboardHomeInsightBand({
  greeting,
  firstName,
  text,
  className,
}: {
  greeting: string;
  firstName: string;
  text: string;
  className?: string;
}) {
  return (
    <FaroTipBand className={className}>
      <strong>
        {greeting}, {firstName}
      </strong>{" "}
      {text}
    </FaroTipBand>
  );
}

import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CheckboxProps {
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean) => void
  className?: string
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked, onCheckedChange }, ref) => {
    const isChecked = checked === true || checked === "indeterminate"
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={isChecked}
        ref={ref}
        onClick={() => onCheckedChange?.(!isChecked)}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center",
          isChecked && "bg-primary text-primary-foreground",
          className
        )}
      >
        {isChecked ? <Check className="h-3 w-3" /> : null}
      </button>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }

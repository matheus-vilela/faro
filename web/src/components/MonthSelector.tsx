import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export interface MonthYear {
  month: number
  year: number
}

interface MonthSelectorProps {
  value: MonthYear
  onChange: (value: MonthYear) => void
  className?: string
}

export function MonthSelector({ value, onChange, className }: MonthSelectorProps) {
  const prevMonth = () => {
    if (value.month === 1) {
      onChange({ month: 12, year: value.year - 1 })
    } else {
      onChange({ month: value.month - 1, year: value.year })
    }
  }

  const nextMonth = () => {
    if (value.month === 12) {
      onChange({ month: 1, year: value.year + 1 })
    } else {
      onChange({ month: value.month + 1, year: value.year })
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={prevMonth}
        aria-label="Mês anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[140px] text-center font-medium">
        {MONTH_NAMES[value.month - 1]} {value.year}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={nextMonth}
        aria-label="Próximo mês"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** Retorna início e fim do mês em ISO string para filtros */
export function getMonthRange(month: number, year: number): { start: string; end: string } {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0, 23, 59, 59, 999)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

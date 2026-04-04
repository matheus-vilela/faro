/** Uma linha de desempenho: checklist + membro atribuído vs meta (janelas 7 e 30 dias). */
export type ChecklistAssignmentStatRow = {
  key: string;
  checklistId: string;
  checklistTitle: string;
  memberId: string;
  memberName: string;
  recurrenceSummary: string;
  expected7: number;
  actual7: number;
  rate7: number;
  expected30: number;
  actual30: number;
  rate30: number;
};

export type ChecklistPerformancePeriod = "7" | "30" | "both";

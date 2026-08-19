import type { Boleto, BoletoEntryKind, BoletoFlowType } from "@/types/expense";
import { isBoletoPayable } from "@/types/expense";
import {
  isUsableBankDescriptionKey,
  normalizeBankDescription,
} from "@/lib/bankReconciliation/normalizeBankDescription";

export type LaunchMemorySuggestion = {
  flowType: BoletoFlowType;
  entryKind: BoletoEntryKind;
  companyCategoryId: string | null;
  description: string;
  originBankAccountId: string | null;
  destBankAccountId: string | null;
};

export type HistoryLaunchRow = {
  bankDescription: string;
  boleto: Pick<
    Boleto,
    | "description"
    | "flow_type"
    | "entry_kind"
    | "company_category_id"
    | "company_bank_account_id"
    | "transfer_group_id"
  >;
  counterpart?: Pick<Boleto, "flow_type" | "company_bank_account_id"> | null;
};

function rowToSuggestion(row: HistoryLaunchRow): LaunchMemorySuggestion {
  const entryKind: BoletoEntryKind =
    row.boleto.entry_kind === "transfer" ? "transfer" : "standard";
  const flowType: BoletoFlowType = isBoletoPayable(row.boleto)
    ? "payable"
    : "receivable";

  let originBankAccountId: string | null = null;
  let destBankAccountId: string | null = null;
  if (entryKind === "transfer") {
    const thisAccount = row.boleto.company_bank_account_id ?? null;
    const otherAccount = row.counterpart?.company_bank_account_id ?? null;
    const thisIsPayable = isBoletoPayable(row.boleto);
    if (thisIsPayable) {
      originBankAccountId = thisAccount;
      destBankAccountId = otherAccount;
    } else {
      destBankAccountId = thisAccount;
      originBankAccountId = otherAccount;
    }
  }

  return {
    flowType,
    entryKind,
    companyCategoryId: row.boleto.company_category_id ?? null,
    description: row.boleto.description?.trim() || row.bankDescription,
    originBankAccountId,
    destBankAccountId,
  };
}

function rowMatchesPrefer(
  row: HistoryLaunchRow,
  prefer?: { entryKind?: BoletoEntryKind; flowType?: BoletoFlowType },
): boolean {
  if (!prefer) return true;
  const entryKind: BoletoEntryKind =
    row.boleto.entry_kind === "transfer" ? "transfer" : "standard";
  if (prefer.entryKind && entryKind !== prefer.entryKind) return false;
  if (prefer.flowType) {
    const flowType: BoletoFlowType = isBoletoPayable(row.boleto)
      ? "payable"
      : "receivable";
    if (flowType !== prefer.flowType) return false;
  }
  return true;
}

/** Histórico mais novo primeiro. Prefere o tipo pedido; senão o primeiro com a mesma chave. */
export function pickLaunchMemoryFromHistory(
  bankDescription: string,
  historyNewestFirst: HistoryLaunchRow[],
  prefer?: { entryKind?: BoletoEntryKind; flowType?: BoletoFlowType },
): LaunchMemorySuggestion | null {
  const key = normalizeBankDescription(bankDescription);
  if (!isUsableBankDescriptionKey(key)) return null;

  const matches = historyNewestFirst.filter(
    (row) => normalizeBankDescription(row.bankDescription) === key,
  );
  if (matches.length === 0) return null;

  const preferred = matches.find((row) => rowMatchesPrefer(row, prefer));
  return rowToSuggestion(preferred ?? matches[0]);
}

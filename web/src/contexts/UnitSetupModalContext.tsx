import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UnitSetupWizard } from "@/components/unit-setup/UnitSetupWizard";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

export type UnitSetupModalPayload =
  | { kind: "new_group" }
  | { kind: "add_unit"; groupId: string }
  | { kind: "resume"; companyId: string };

type UnitSetupModalContextValue = {
  openModal: (payload: UnitSetupModalPayload) => void;
  closeModal: () => void;
};

const UnitSetupModalContext = createContext<
  UnitSetupModalContextValue | undefined
>(undefined);

/** Select (Radix) renderiza o menu em portal; cliques não podem fechar o Dialog. */
function isRadixSelectUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    [
      '[data-slot="select-content"]',
      '[data-slot="select-item"]',
      '[data-slot="select-scroll-up-button"]',
      '[data-slot="select-scroll-down-button"]',
      '[role="listbox"]',
    ].join(","),
  );
}

export function UnitSetupModalProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<UnitSetupModalPayload | null>(null);
  const [sessionKey, setSessionKey] = useState(0);

  const closeModal = useCallback(() => {
    setOpen(false);
    setPayload(null);
  }, []);

  const openModal = useCallback((p: UnitSetupModalPayload) => {
    setPayload(p);
    setSessionKey((k) => k + 1);
    setOpen(true);
  }, []);

  /** Pausar / concluir: mesmo comportamento anterior (ir ao início do app). */
  const handleExitToApp = useCallback(() => {
    closeModal();
    navigate("/app", { replace: true });
  }, [closeModal, navigate]);

  const value = useMemo(
    () => ({ openModal, closeModal }),
    [openModal, closeModal],
  );

  const wizardProps =
    payload?.kind === "new_group"
      ? {
          createNewGroup: true as const,
          newUnitGroupId: null as string | null,
          resumeCompanyId: undefined as string | undefined,
        }
      : payload?.kind === "add_unit"
        ? {
            createNewGroup: false as const,
            newUnitGroupId: payload.groupId,
            resumeCompanyId: undefined as string | undefined,
          }
        : payload?.kind === "resume"
          ? {
              createNewGroup: false as const,
              newUnitGroupId: null as string | null,
              resumeCompanyId: payload.companyId,
            }
          : null;

  return (
    <UnitSetupModalContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent
          showCloseButton
          className="z-[60] max-h-[min(92vh,880px)] w-[calc(100vw-1.5rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl"
          onPointerDownOutside={(e) => {
            if (isRadixSelectUiTarget(e.target)) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isRadixSelectUiTarget(e.target)) e.preventDefault();
          }}
          onFocusOutside={(e) => {
            if (isRadixSelectUiTarget(e.target)) e.preventDefault();
          }}
        >
          <div className="max-h-[min(92vh,880px)] overflow-y-auto p-4 sm:p-6">
            <DialogHeader className="sr-only">
              <DialogTitle>Configurar unidade</DialogTitle>
              <DialogDescription>
                Assistente de cadastro da unidade em etapas.
              </DialogDescription>
            </DialogHeader>
            {wizardProps ? (
              <UnitSetupWizard
                key={sessionKey}
                variant="modal"
                createNewGroup={wizardProps.createNewGroup}
                newUnitGroupId={wizardProps.newUnitGroupId}
                resumeCompanyId={wizardProps.resumeCompanyId}
                onExit={handleExitToApp}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </UnitSetupModalContext.Provider>
  );
}

export function useUnitSetupModal() {
  const ctx = useContext(UnitSetupModalContext);
  if (!ctx) {
    throw new Error(
      "useUnitSetupModal must be used within UnitSetupModalProvider",
    );
  }
  return ctx;
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Company } from "@/contexts/CompanyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { XIcon } from "lucide-react";

export type UnitSetupModalPayload =
  | { kind: "new_group" }
  | { kind: "add_unit"; groupId: string }
  | { kind: "resume"; companyId: string };

type UnitSetupModalContextValue = {
  openModal: (payload: UnitSetupModalPayload) => void;
  closeModal: () => void;
  /** Abre o diálogo de confirmação; em “Sair”, executa `onConfirm`. */
  requestLeaveConfirm: (onConfirm: () => void) => void;
};

const UnitSetupModalContext = createContext<
  UnitSetupModalContextValue | undefined
>(undefined);

export function UnitSetupModalProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { setCurrentCompany } = useCompany();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<UnitSetupModalPayload | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const leaveConfirmActionRef = useRef<(() => void) | null>(null);

  const requestLeaveConfirm = useCallback((onConfirm: () => void) => {
    leaveConfirmActionRef.current = onConfirm;
    setLeaveConfirmOpen(true);
  }, []);

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
  const handleExitToApp = useCallback(
    (payload?: { companyId?: string; completed?: boolean }) => {
      void (async () => {
        closeModal();
        if (payload?.completed && payload.companyId) {
          const { data } = await supabase
            .from("companies")
            .select("*")
            .eq("id", payload.companyId)
            .maybeSingle();
          if (data) {
            setCurrentCompany(data as Company);
          }
        }
        navigate("/app", { replace: true });
      })();
    },
    [closeModal, navigate, setCurrentCompany],
  );

  const value = useMemo(
    () => ({ openModal, closeModal, requestLeaveConfirm }),
    [openModal, closeModal, requestLeaveConfirm],
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
      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={(next) => {
          if (!next) setLeaveConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do onboarding?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem a certeza que deseja sair? O progresso é guardado e pode
              retomar mais tarde nas configurações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                leaveConfirmActionRef.current = null;
              }}
            >
              Continuar a configurar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const fn = leaveConfirmActionRef.current;
                leaveConfirmActionRef.current = null;
                fn?.();
              }}
            >
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="z-[60] max-h-[min(92vh,880px)] w-[calc(100vw-1.5rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            requestLeaveConfirm(() => closeModal());
          }}
        >
          <div className="flex max-h-[min(92vh,880px)] min-h-0 flex-col">
            <div className="flex shrink-0 justify-end px-3 pt-3">
              <button
                type="button"
                className="rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                onClick={() => requestLeaveConfirm(() => closeModal())}
                aria-label="Fechar onboarding"
              >
                <XIcon />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
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

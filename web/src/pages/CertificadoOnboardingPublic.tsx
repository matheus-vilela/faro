import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { CertificateUploadFields } from "@/components/unit-setup/steps/CertificateUploadFields";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme } from "@/contexts/ThemeContext";
import { fileToPureBase64 } from "@/services/focusCriaEmpresaService";
import {
  getSetupCertificateDelegationPublic,
  submitDelegatedCertificate,
} from "@/services/setupCertificateDelegationService";
import { Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function PublicPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen justify-center overflow-y-auto bg-background p-4 py-10">
      <Link
        to="/"
        className="absolute left-4 top-4 z-20 flex items-center transition-opacity hover:opacity-90 sm:left-6 sm:top-6"
        aria-label="Faro — início"
      >
        <img
          src={resolvedTheme === "dark" ? logoDark : logoLight}
          alt=""
          width={140}
          height={40}
          className="h-8 w-auto max-w-[min(140px,50vw)] object-contain object-left sm:h-12"
          decoding="async"
        />
      </Link>
      <div
        className="pointer-events-none fixed inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-lg pt-10">{children}</div>
    </div>
  );
}

function linkErrorMessage(code: string): string {
  if (code === "used") {
    return "Este link já foi utilizado e não está mais disponível.";
  }
  if (code === "expired") {
    return "Este link expirou. Solicite um novo link a quem configurou a unidade.";
  }
  if (code === "inactive" || code === "not_found") {
    return "Link inválido ou inacessível.";
  }
  return "Não foi possível abrir este link.";
}

export function CertificadoOnboardingPublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [password, setPassword] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [certBase64, setCertBase64] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await getSetupCertificateDelegationPublic(token);
    setLoading(false);
    if (!res.ok) {
      setError(linkErrorMessage(res.error));
      return;
    }
    setCompanyName(res.companyName);
    setError(null);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePickFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pfx") && !lower.endsWith(".p12")) {
      setError("Use um arquivo .pfx ou .p12 (certificado A1).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const b64 = await fileToPureBase64(file);
      setCertBase64(b64);
      setFileName(file.name);
    } catch {
      setError("Não foi possível ler o arquivo do certificado.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!token) return;
    if (!certBase64.trim() || !password.trim()) {
      setError("Envie o certificado e informe a senha.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await submitDelegatedCertificate(token, certBase64, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  };

  if (loading) {
    return (
      <PublicPageShell>
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </PublicPageShell>
    );
  }

  if (error && !companyName && !done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Link indisponível</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  if (done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Certificado conectado
            </CardTitle>
            <CardDescription>
              O certificado de <strong>{companyName}</strong> foi validado com
              sucesso. Este link não pode mais ser utilizado.
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell>
      <Card>
        <CardHeader>
          <CardTitle>Enviar certificado digital</CardTitle>
          <CardDescription>
            Conecte o certificado A1 da unidade <strong>{companyName}</strong> à
            SEFAZ. Por segurança, a senha e o arquivo não ficam salvos na Faro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CertificateUploadFields
            cert={{
              status: certBase64 ? "uploaded" : "not_sent",
              file_name: fileName,
            }}
            password={password}
            onPasswordChange={setPassword}
            onPickFile={(f) => void handlePickFile(f)}
            busy={busy}
            showStatus={false}
            lockWhenValid={false}
          />
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Validando certificado…
              </>
            ) : (
              "Enviar certificado"
            )}
          </Button>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}

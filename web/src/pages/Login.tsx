import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export function Login() {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const senhaRedefinida = searchParams.get("senha") === "redefinida";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      const safe =
        redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
          ? redirectTo
          : "/empresas";
      navigate(safe, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = forgotEmail.trim();
    if (!addr) {
      setForgotError("Informe seu email.");
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    try {
      const redirectTo = `${window.location.origin}/redefinir-senha`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        addr,
        { redirectTo },
      );
      if (resetErr) throw resetErr;
      toast.success(
        "Se existir uma conta com este email, você receberá um link para redefinir a senha.",
        { duration: 8000 },
      );
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err: unknown) {
      setForgotError(
        err instanceof Error ? err.message : "Não foi possível enviar o email.",
      );
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
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
        className="pointer-events-none absolute inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_75%)]"
        aria-hidden
      />
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Entrar</CardTitle>
          <CardDescription>
            Digite seu email e senha para acessar sua conta
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {senhaRedefinida && (
              <p className="text-sm text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-md">
                Senha alterada com sucesso. Entre com a nova senha.
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">Senha</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotError(null);
                    setForgotOpen(true);
                  }}
                >
                  Esqueci minha senha
                </button>
              </div>
              <PasswordInput
                id="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 mt-6">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Não tem conta?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Cadastre-se
              </Link>
            </p>
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← Voltar à página inicial
            </Link>
          </CardFooter>
        </form>
      </Card>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleForgotSubmit}>
            <DialogHeader>
              <DialogTitle>Recuperar senha</DialogTitle>
              <DialogDescription>
                Enviaremos um link para o seu email. <br />
                Confira também a caixa de spam.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {forgotError && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {forgotError}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setForgotOpen(false)}
                disabled={forgotLoading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={forgotLoading}>
                {forgotLoading ? "Enviando…" : "Enviar link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

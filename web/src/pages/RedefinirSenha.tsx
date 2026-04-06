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
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

/**
 * Rota de destino do link enviado por email (resetPasswordForEmail).
 * Adicione a URL completa em Authentication → URL Configuration → Redirect URLs no Supabase.
 */
export function RedefinirSenha() {
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [canReset, setCanReset] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const trySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return false;
      if (data.session) {
        setCanReset(true);
        setChecking(false);
        return true;
      }
      return false;
    };

    void (async () => {
      if (await trySession()) return;
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled) return;
      if (await trySession()) return;
      await new Promise((r) => setTimeout(r, 900));
      if (cancelled) return;
      if (await trySession()) return;
      setChecking(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (
        (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") &&
        session
      ) {
        setCanReset(true);
        setChecking(false);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = password.trim();
    if (p.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (p !== confirm.trim()) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({
        password: p,
      });
      if (updErr) throw updErr;
      await supabase.auth.signOut();
      toast.success("Senha alterada. Faça login com a nova senha.");
      navigate("/login?senha=redefinida", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setLoading(false);
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
          <CardTitle className="text-2xl">Nova senha</CardTitle>
          <CardDescription>
            Defina uma nova senha para sua conta Faro.
          </CardDescription>
        </CardHeader>

        {checking ? (
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Validando o link de recuperação…
            </p>
          </CardContent>
        ) : !canReset ? (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Este link é inválido ou expirou. Solicite um novo email na tela de
              login.
            </p>
            <Button className="w-full" asChild variant="outline">
              <Link to="/login">Voltar ao login</Link>
            </Button>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar senha</Label>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4 mt-2">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Salvando…" : "Salvar nova senha"}
              </Button>
              <Link
                to="/login"
                className="text-sm text-muted-foreground hover:underline text-center"
              >
                Voltar ao login
              </Link>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}

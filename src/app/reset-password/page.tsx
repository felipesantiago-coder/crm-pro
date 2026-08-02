'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Lock, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';

function ResetPasswordForm() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setError('Token não fornecido. Solicite uma nova redefinição de senha.');
    }
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    // Validações client-side (espelho do Zod do backend)
    if (newPassword.length < 8) {
      setError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError('A senha deve conter pelo menos uma letra maiúscula.');
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setError('A senha deve conter pelo menos uma letra minúscula.');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError('A senha deve conter pelo menos um número.');
      return;
    }

    if (!token) {
      setError('Token não fornecido. Solicite uma nova redefinição.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Erro ao redefinir senha.');
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError('Erro ao conectar com o servidor. Tente novamente.');
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md relative z-10 shadow-2xl border-0">
      <CardHeader className="text-center space-y-4 pb-2">
        <div className="mx-auto h-14 w-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
          <span className="text-white font-bold text-2xl">C</span>
        </div>
        <div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            <span className="text-emerald-600">CRM</span>{' '}
            <span className="text-foreground">Pro</span>
          </CardTitle>
          <CardDescription className="text-muted-foreground mt-1">
            {success ? 'Senha redefinida' : 'Nova senha'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {success ? (
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-foreground font-medium">Senha alterada com sucesso!</p>
              <p className="text-sm text-muted-foreground mt-2">
                Sua senha foi atualizada. Você já pode fazer login com a nova senha.
              </p>
            </div>
            <Button
              className="w-full mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
              onClick={() => router.push('/login')}
            >
              Ir para o login
            </Button>
          </div>
        ) : (
          <>
            {error && !token && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nova senha</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading || !token}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repita a nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading || !token}
                  className="h-11"
                />
              </div>
              {error && token && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {error}
                </p>
              )}
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>A senha deve conter:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>No mínimo 8 caracteres</li>
                  <li>Pelo menos uma letra maiúscula</li>
                  <li>Pelo menos uma letra minúscula</li>
                  <li>Pelo menos um número</li>
                </ul>
              </div>
              <Button
                type="submit"
                disabled={loading || !token}
                className="w-full h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold transition-all duration-200"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redefinindo...
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    Redefinir senha
                  </>
                )}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link
                href="/login"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" />
                Voltar ao login
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
      </div>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}

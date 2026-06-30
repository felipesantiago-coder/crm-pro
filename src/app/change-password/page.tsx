'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Lock, Eye, EyeOff, Check, X } from 'lucide-react';

export default function ChangePasswordPage() {
  const { data: session, status } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Redirecionar para login se não autenticado
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Tela de carregamento
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center animate-pulse">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <p className="text-sm text-white/80">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const minLengthMet = newPassword.length >= 6;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Erro ao alterar senha.');
        setLoading(false);
        return;
      }

      toast.success('Senha alterada com sucesso! Faça login novamente.');
      await signOut({ callbackUrl: '/login' });
    } catch {
      toast.error('Erro ao alterar senha. Tente novamente.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative z-10 shadow-2xl border-0">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto h-14 w-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Lock className="h-7 w-7 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              Alterar Senha
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              {session?.user?.email && (
                <span className="text-sm">{session.user.email}</span>
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Senha Atual</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrent ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nova Senha</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNew ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                {newPassword.length > 0 && (
                  <span className={minLengthMet ? 'text-emerald-600' : 'text-red-500'}>
                    {minLengthMet ? (
                      <Check className="h-3.5 w-3.5 inline mr-1" />
                    ) : (
                      <X className="h-3.5 w-3.5 inline mr-1" />
                    )}
                    Mínimo 6 caracteres ({newPassword.length}/6)
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Nova Senha</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className={passwordsMatch ? 'text-emerald-600' : 'text-red-500'}>
                    {passwordsMatch ? (
                      <Check className="h-3.5 w-3.5 inline mr-1" />
                    ) : (
                      <X className="h-3.5 w-3.5 inline mr-1" />
                    )}
                    {passwordsMatch ? 'Senhas coincidem' : 'Senhas não coincidem'}
                  </span>
                </div>
              )}
            </div>
            <Button
              type="submit"
              disabled={loading || !minLengthMet || !passwordsMatch}
              className="w-full h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold transition-all duration-200"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Alterando...
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Alterar Senha
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full text-sm text-white/60 hover:text-white transition-colors py-1"
            >
              Sair e fazer login com outra conta
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

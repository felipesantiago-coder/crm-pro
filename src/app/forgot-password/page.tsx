'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar solicitação.');
        setLoading(false);
        return;
      }

      setSent(true);
    } catch {
      toast.error('Erro ao conectar com o servidor. Tente novamente.');
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
          {/* Logo */}
          <div className="mx-auto h-14 w-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-2xl">C</span>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              <span className="text-emerald-600">CRM</span>{' '}
              <span className="text-foreground">Pro</span>
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              {sent ? 'Verifique seu email' : 'Recuperar sua senha'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-foreground font-medium">Email enviado com sucesso!</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Se o email <strong>{email}</strong> estiver cadastrado no sistema,
                  você receberá as instruções para redefinir sua senha.
                  Verifique também sua caixa de spam.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => router.push('/login')}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar ao login
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Informe o email cadastrado na sua conta e enviaremos as instruções
                para redefinir sua senha.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    className="h-11"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold transition-all duration-200"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Enviar instruções
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
    </div>
  );
}

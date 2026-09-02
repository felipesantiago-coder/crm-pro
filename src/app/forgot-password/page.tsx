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
import { BrandLogo, BrandSymbol } from '@/components/brand';

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
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3">
        <BrandSymbol size={44} priority />
        <BrandLogo width={176} priority />
      </div>

      <Card className="w-full max-w-md shadow-md">
        <CardHeader className="text-center space-y-1 pb-2">
          <CardTitle className="text-2xl font-bold tracking-tight">
            {sent ? 'Verifique seu email' : 'Recuperar sua senha'}
          </CardTitle>
          <CardDescription className="text-muted-foreground mt-1">
            {sent ? 'Enviamos as instruções para o seu email' : 'Informe seu email para continuar'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success" />
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
                    autoComplete="email"
                    inputMode="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  className="w-full h-11 font-semibold"
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

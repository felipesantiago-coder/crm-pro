'use client';

import { useState, useEffect } from 'react';
import { signIn, getSession, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, LogIn } from 'lucide-react';
import Link from 'next/link';
import { BrandLogo, BrandSymbol } from '@/components/brand';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { data: session, status } = useSession();

  // Redirecionar para a página principal se já autenticado
  useEffect(() => {
    if (status === 'authenticated' && session) {
      if ((session.user as { mustChangePassword?: boolean }).mustChangePassword) {
        router.push('/change-password');
      } else {
        router.push('/');
      }
    }
  }, [status, session, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        toast.error('Credenciais inválidas. Verifique seu email e senha.', {
          'aria-live': 'assertive',
        } as never);
        setLoading(false);
        return;
      }

      // Check session to see if mustChangePassword
      const session = await getSession();
      if (session?.user && (session.user as { mustChangePassword?: boolean }).mustChangePassword) {
        router.push('/change-password');
      } else {
        router.push('/');
      }
    } catch {
      toast.error('Erro ao fazer login. Tente novamente.', {
        'aria-live': 'assertive',
      } as never);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row bg-background">
      {/* Painel de marca — desktop (força variante escura da marca via classe .dark local) */}
      <aside
        aria-hidden="true"
        className="dark relative hidden lg:flex lg:w-[46%] xl:w-[48%] flex-col justify-between overflow-hidden bg-brand-midnight p-10 xl:p-14"
      >
        {/* Contornos ampliados e translúcidos dos módulos entrelaçados */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full border-[28px] border-brand-indigo/20" />
          <div className="absolute -bottom-40 -left-24 h-[460px] w-[460px] rounded-full border-[28px] border-brand-cyan/15" />
          <div className="absolute top-1/3 left-1/2 h-[280px] w-[280px] rounded-full border-2 border-white/5" />
        </div>

        <div className="relative">
          <BrandLogo variant="horizontal-tagline" width={230} priority />
        </div>

        <div className="relative max-w-md space-y-4">
          <p className="text-3xl xl:text-4xl font-bold leading-tight text-white">
            Conexões que avançam.
          </p>
          <p className="text-base leading-relaxed text-[#B8C0D4]">
            Clientes, equipe, dados e oportunidades integrados em um fluxo
            contínuo para o seu negócio crescer com organização e velocidade.
          </p>
        </div>

        <p className="relative text-xs text-[#B8C0D4]/70">
          © {new Date().getFullYear()} CRM Pro
        </p>
      </aside>

      {/* Área do formulário */}
      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        {/* Marca compacta no mobile */}
        <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
          <BrandSymbol size={44} priority />
          <BrandLogo width={176} priority />
        </div>

        <div className="w-full max-w-md">
          <div className="mb-8 hidden lg:block">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Acesse sua conta
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bem-vindo de volta. Entre com suas credenciais.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                aria-describedby="email-error"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                aria-describedby="password-error"
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
                  <span>Entrando...</span>
                  <span className="sr-only">Enviando credenciais</span>
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Entrar
                </>
              )}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              Esqueceu sua senha?
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

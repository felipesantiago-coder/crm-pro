'use client';

import React, { lazy, Suspense } from 'react';
import { ThemeProvider } from 'next-themes';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CRMLayout } from '@/components/crm/crm-layout';
import { SupabaseRealtimeProvider } from '@/components/crm/supabase-realtime-provider';
import { useCRMStore } from '@/store/crm-store';
import { Toaster } from '@/components/ui/sonner';

// Code splitting: carrega apenas a view ativa
const DashboardView = lazy(() =>
  import('@/components/crm/dashboard-view').then((m) => ({ default: m.DashboardView }))
);
const ClientsView = lazy(() =>
  import('@/components/crm/clients-view').then((m) => ({ default: m.ClientsView }))
);
const TagsView = lazy(() =>
  import('@/components/crm/tags-view').then((m) => ({ default: m.TagsView }))
);
const RemindersView = lazy(() =>
  import('@/components/crm/reminders-view').then((m) => ({ default: m.RemindersView }))
);
const SettingsView = lazy(() =>
  import('@/components/crm/settings-view').then((m) => ({ default: m.SettingsView }))
);
const AdminPanel = lazy(() =>
  import('@/components/crm/admin-panel').then((m) => ({ default: m.AdminPanel }))
);
const ClosedDealsView = lazy(() =>
  import('@/components/crm/closed-deals-view').then((m) => ({ default: m.ClosedDealsView }))
);

function ViewLoader() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse bg-muted rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function CRMApp() {
  const { currentView } = useCRMStore();
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (session?.user && (session.user as { mustChangePassword?: boolean }).mustChangePassword) {
      router.push('/change-password');
    }
  }, [session, status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center animate-pulse">
            <span className="text-white font-bold text-xl">C</span>
          </div>
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  function renderView() {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'clients':
        return <ClientsView />;
      case 'closed-deals':
        return <ClosedDealsView />;
      case 'tags':
        return <TagsView />;
      case 'reminders':
        return <RemindersView />;
      case 'settings':
        return <SettingsView />;
      case 'admin':
        return <AdminPanel />;
      default:
        return <DashboardView />;
    }
  }

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange={false}
    >
      <SupabaseRealtimeProvider>
        <CRMLayout>
          <Suspense fallback={<ViewLoader />}>
            {renderView()}
          </Suspense>
        </CRMLayout>
      </SupabaseRealtimeProvider>
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}

export default function Home() {
  return <CRMApp />;
}

'use client';

import { ThemeProvider } from 'next-themes';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { CRMLayout } from '@/components/crm/crm-layout';
import { DashboardView } from '@/components/crm/dashboard-view';
import { ClientsView } from '@/components/crm/clients-view';
import { TagsView } from '@/components/crm/tags-view';
import { RemindersView } from '@/components/crm/reminders-view';
import { SettingsView } from '@/components/crm/settings-view';
import { AdminPanel } from '@/components/crm/admin-panel';
import { SupabaseRealtimeProvider } from '@/components/crm/supabase-realtime-provider';
import { useCRMStore } from '@/store/crm-store';
import { Toaster } from '@/components/ui/sonner';

function CRMApp() {
  const { currentView } = useCRMStore();
  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session?.user && (session.user as { mustChangePassword?: boolean }).mustChangePassword) {
      router.push('/change-password');
    }
  }, [session, router]);

  function renderView() {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'clients':
        return <ClientsView />;
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
        <CRMLayout>{renderView()}</CRMLayout>
      </SupabaseRealtimeProvider>
      <Toaster position="top-right" richColors />
    </ThemeProvider>
  );
}

export default function Home() {
  return <CRMApp />;
}

'use client';

import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Tags,
  Bell,
  Settings,
  Menu,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Megaphone,
  LogOut,
  KeyRound,
  Trophy,
  Building2,
  BarChart3,
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useCRMStore, type CRMView } from '@/store/crm-store';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { BrandLogo, BrandSymbol, BrandWordmark } from '@/components/brand';

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { currentView, setCurrentView, notificationReminders } = useCRMStore();
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role;

  const navItems: { view: CRMView; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
    { view: 'enterprises', label: 'Empreendimentos', icon: <Building2 className="h-5 w-5" /> },
    { view: 'clients', label: 'Clientes', icon: <Users className="h-5 w-5" /> },
    { view: 'closed-deals', label: 'Negócios Finalizados', icon: <Trophy className="h-5 w-5" /> },
    { view: 'tags', label: 'Tags', icon: <Tags className="h-5 w-5" /> },
    { view: 'reminders', label: 'Lembretes', icon: <Bell className="h-5 w-5" /> },
    { view: 'reports', label: 'Relatórios', icon: <BarChart3 className="h-5 w-5" /> },
    { view: 'meta-ads', label: 'Anúncios Meta', icon: <Megaphone className="h-5 w-5" />, adminOnly: true },
    { view: 'admin', label: 'Administração', icon: <ShieldCheck className="h-5 w-5" />, adminOnly: true },
    { view: 'settings', label: 'Configurações', icon: <Settings className="h-5 w-5" /> },
  ];

  const visibleItems = navItems.filter(
    (item) => !item.adminOnly || userRole === 'ADMIN'
  );

  return (
    <TooltipProvider delayDuration={0}>
      <nav aria-label="Navegação principal" className="flex flex-col gap-1 mt-2 relative">
        {visibleItems.map((item) => {
          const isActive = currentView === item.view;
          const reminderCount =
            item.view === 'reminders'
              ? notificationReminders.length
              : 0;

          const button = (
            <button
              key={item.view}
              onClick={() => {
                setCurrentView(item.view);
                onNavigate?.();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-200 relative',
                'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
                collapsed && 'justify-center',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                  : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
              )}
            >
              {/* Marcador lateral do item ativo (não depende apenas de cor) */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-sidebar-primary transition-opacity duration-200',
                  isActive ? 'opacity-100' : 'opacity-0'
                )}
              />
              <span className={cn('flex-shrink-0', isActive ? 'text-sidebar-primary' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground')}>
                {item.icon}
              </span>
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && reminderCount > 0 && (
                <Badge variant="destructive" className="h-5 min-w-[20px] flex items-center justify-center px-1.5 text-[10px] font-bold">
                  {reminderCount}
                </Badge>
              )}
              {collapsed && reminderCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-1">
                  {reminderCount}
                </span>
              )}
            </button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.view} delayDuration={0}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </nav>
    </TooltipProvider>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { data: session } = useSession();

  const userName = session?.user?.name || 'Usuário';
  const userEmail = session?.user?.email || '';
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="w-full justify-center" aria-label={`Menu do usuário: ${userName}`}>
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gradient-to-br from-brand-indigo to-brand-cyan text-white text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{userName}</p>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => window.location.href = '/change-password'}>
            <KeyRound className="h-4 w-4 mr-2" />
            Alterar Senha
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-destructive focus:text-destructive">
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start px-3 py-2 h-auto">
          <div className="flex items-center gap-3 w-full">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-brand-indigo to-brand-cyan text-white text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
            </div>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{userName}</p>
          <p className="text-xs text-muted-foreground">{userEmail}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.location.href = '/change-password'}>
          <KeyRound className="h-4 w-4 mr-2" />
          Alterar Senha
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CRMLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, toggleSidebar } = useCRMStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-background overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed left-0 top-0 h-full z-40 border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
          sidebarCollapsed ? 'w-[var(--sidebar-width-collapsed)]' : 'w-[var(--sidebar-width)]'
        )}
      >
        <div className="flex items-center h-[64px] px-4 border-b border-sidebar-border">
          {sidebarCollapsed ? (
            <div className="mx-auto">
              <BrandSymbol size={34} priority />
              <span className="sr-only">CRM Pro</span>
            </div>
          ) : (
            <div className="flex items-center">
              <BrandLogo width={170} priority />
            </div>
          )}
        </div>

        <div className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
          <SidebarNav collapsed={sidebarCollapsed} />
        </div>

        <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
          <UserMenu collapsed={sidebarCollapsed} />
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={toggleSidebar} className="w-full justify-center" aria-label="Expandir painel">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Expandir painel</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="ghost" size="sm" onClick={toggleSidebar} className="w-full justify-center">
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>Recolher</span>
            </Button>
          )}
        </div>
      </aside>

      {/* Mobile Header + Sheet Sidebar */}
      <div className="flex-1 lg:ml-0 min-w-0">
        <header className="lg:hidden sticky top-0 z-30 flex items-center h-14 px-4 border-b bg-sidebar text-sidebar-foreground">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="mr-2 min-h-[44px] min-w-[44px]" aria-label="Abrir menu de navegação">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[304px] max-w-[calc(100vw-32px)] p-0 bg-sidebar text-sidebar-foreground">
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <div className="flex items-center h-14 px-4 border-b border-sidebar-border">
                <div className="flex items-center">
                  <BrandLogo width={158} priority />
                </div>
              </div>
              <div className="px-3 py-4">
                <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-sidebar-border safe-area-bottom">
                <UserMenu collapsed={false} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <BrandSymbol size={28} priority />
            <BrandWordmark width={92} priority />
          </div>
        </header>

        {/* Main content */}
        <main
          className={cn(
            'transition-[margin] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
            sidebarCollapsed ? 'lg:ml-[var(--sidebar-width-collapsed)]' : 'lg:ml-[var(--sidebar-width)]'
          )}
        >
          <div className="mx-auto w-full max-w-[1560px] p-4 sm:p-5 lg:p-6 2xl:px-8 overflow-x-hidden">{children}</div>
        </main>
      </div>
    </div>
  );
}

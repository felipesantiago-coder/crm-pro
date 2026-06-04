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
  LogOut,
  KeyRound,
  User,
  Trophy,
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useCRMStore, type CRMView } from '@/store/crm-store';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { currentView, setCurrentView, notificationReminders } = useCRMStore();
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role;

  const navItems: { view: CRMView; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
    { view: 'clients', label: 'Clientes', icon: <Users className="h-5 w-5" /> },
    { view: 'closed-deals', label: 'Negócios Finalizados', icon: <Trophy className="h-5 w-5" /> },
    { view: 'tags', label: 'Tags', icon: <Tags className="h-5 w-5" /> },
    { view: 'reminders', label: 'Lembretes', icon: <Bell className="h-5 w-5" /> },
    { view: 'admin', label: 'Administração', icon: <ShieldCheck className="h-5 w-5" />, adminOnly: true },
    { view: 'settings', label: 'Configurações', icon: <Settings className="h-5 w-5" /> },
  ];

  const visibleItems = navItems.filter(
    (item) => !item.adminOnly || userRole === 'ADMIN'
  );

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex flex-col gap-1 mt-2 relative">
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
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 relative',
                collapsed && 'justify-center',
                isActive
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span className={cn('flex-shrink-0', isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
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
          <Button variant="ghost" size="icon" className="w-full justify-center">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-semibold">
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
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-red-600 focus:text-red-600">
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
              <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white text-xs font-semibold">
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
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-red-600 focus:text-red-600">
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
    <div className="min-h-screen flex bg-background">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed left-0 top-0 h-full z-40 border-r bg-card transition-all duration-300',
          sidebarCollapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">C</span>
              </div>
              <span className="font-bold text-lg tracking-tight">
                <span className="text-emerald-600 dark:text-emerald-400">CRM</span>{' '}
                <span className="text-foreground">Pro</span>
              </span>
            </div>
          )}
          {sidebarCollapsed && (
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto">
              <span className="text-white font-bold text-sm">C</span>
            </div>
          )}
        </div>

        <div className="flex-1 px-3 py-4 overflow-y-auto">
          <SidebarNav collapsed={sidebarCollapsed} />
        </div>

        <div className="px-3 py-3 border-t space-y-1">
          <UserMenu collapsed={sidebarCollapsed} />
          {sidebarCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={toggleSidebar} className="w-full justify-center">
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
      <div className="flex-1 lg:ml-0">
        <header className="lg:hidden sticky top-0 z-30 flex items-center h-14 px-4 border-b bg-card">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="mr-2">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] p-0">
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <div className="flex items-center h-14 px-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                    <span className="text-white font-bold text-sm">C</span>
                  </div>
                  <span className="font-bold text-lg tracking-tight">
                    <span className="text-emerald-600 dark:text-emerald-400">CRM</span>{' '}
                    <span className="text-foreground">Pro</span>
                  </span>
                </div>
              </div>
              <div className="px-3 py-4">
                <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-3 border-t">
                <UserMenu collapsed={false} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">C</span>
            </div>
            <span className="font-bold text-base tracking-tight">
              <span className="text-emerald-600 dark:text-emerald-400">CRM</span>{' '}
              <span className="text-foreground">Pro</span>
            </span>
          </div>
        </header>

        {/* Main content */}
        <main
          className={cn(
            'transition-all duration-300',
            sidebarCollapsed ? 'lg:ml-[68px]' : 'lg:ml-[260px]'
          )}
        >
          <div className="p-4 sm:p-5 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

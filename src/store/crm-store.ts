import { create } from 'zustand';

export type CRMView = 'dashboard' | 'clients' | 'closed-deals' | 'tags' | 'reminders' | 'settings' | 'admin';

interface CRMState {
  currentView: CRMView;
  sidebarCollapsed: boolean;
  selectedClientId: string | null;
  searchQuery: string;
  filterRegion: string;
  filterTagId: string;
  notificationReminders: Array<{
    id: string;
    title: string;
    description: string | null;
    dueDate: string;
    client: { id: string; name: string };
  }>;

  setCurrentView: (view: CRMView) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSelectedClientId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setFilterRegion: (region: string) => void;
  setFilterTagId: (tagId: string) => void;
  setNotificationReminders: (reminders: CRMState['notificationReminders']) => void;
  clearFilters: () => void;
}

export const useCRMStore = create<CRMState>((set) => ({
  currentView: 'dashboard',
  sidebarCollapsed: false,
  selectedClientId: null,
  searchQuery: '',
  filterRegion: '',
  filterTagId: '',
  notificationReminders: [],

  setCurrentView: (view) => set({ currentView: view }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSelectedClientId: (id) => set({ selectedClientId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterRegion: (region) => set({ filterRegion: region }),
  setFilterTagId: (tagId) => set({ filterTagId: tagId }),
  setNotificationReminders: (reminders) => set({ notificationReminders: reminders }),
  clearFilters: () => set({ searchQuery: '', filterRegion: '', filterTagId: '' }),
}));

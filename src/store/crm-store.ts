import { create } from 'zustand';

export type CRMView = 'dashboard' | 'enterprises' | 'clients' | 'closed-deals' | 'tags' | 'reminders' | 'meta-ads' | 'reports' | 'settings' | 'admin' | 'clientDetail';

interface CRMState {
  currentView: CRMView;
  sidebarCollapsed: boolean;
  selectedClientId: string | null;
  searchQuery: string;
  filterRegion: string;
  filterTagIds: string[];
  notificationReminders: Array<{
    id: string;
    title: string;
    description: string | null;
    dueDate: string;
    client: { id: string; name: string };
  }>;
  /**
   * Pedidos de navegação do Nexo (ações allowlisted — prompt v2.0 §20).
   * Views observam o id crescente e aplicam localmente. Nenhuma escrita.
   */
  clientDetailRequest: { id: number; clientId: string } | null;
  enterpriseOpenRequest: { id: number; enterpriseId: string } | null;
  clientFilterRequest: { id: number; stage?: string; tagIds?: string[] } | null;

  setCurrentView: (view: CRMView) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSelectedClientId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  setFilterRegion: (region: string) => void;
  setFilterTagIds: (tagIds: string[]) => void;
  addFilterTagId: (tagId: string) => void;
  removeFilterTagId: (tagId: string) => void;
  setNotificationReminders: (reminders: CRMState['notificationReminders']) => void;
  clearFilters: () => void;
  requestOpenClient: (clientId: string) => void;
  requestOpenEnterprise: (enterpriseId: string) => void;
  requestApplyClientFilter: (stage?: string, tagIds?: string[]) => void;
}

export const useCRMStore = create<CRMState>((set) => ({
  currentView: 'dashboard',
  sidebarCollapsed: false,
  selectedClientId: null,
  searchQuery: '',
  filterRegion: '',
  filterTagIds: [],
  notificationReminders: [],
  clientDetailRequest: null,
  enterpriseOpenRequest: null,
  clientFilterRequest: null,

  setCurrentView: (view) => set({ currentView: view }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSelectedClientId: (id) => set({ selectedClientId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterRegion: (region) => set({ filterRegion: region }),
  setFilterTagIds: (tagIds) => set({ filterTagIds: tagIds }),
  addFilterTagId: (tagId) => set((state) => ({
    filterTagIds: state.filterTagIds.includes(tagId)
      ? state.filterTagIds
      : [...state.filterTagIds, tagId],
  })),
  removeFilterTagId: (tagId) => set((state) => ({
    filterTagIds: state.filterTagIds.filter((id) => id !== tagId),
  })),
  setNotificationReminders: (reminders) => set({ notificationReminders: reminders }),
  clearFilters: () => set({ searchQuery: '', filterRegion: '', filterTagIds: [] }),
  requestOpenClient: (clientId) =>
    set((state) => ({
      currentView: 'clients',
      selectedClientId: clientId,
      clientDetailRequest: { id: (state.clientDetailRequest?.id ?? 0) + 1, clientId },
    })),
  requestOpenEnterprise: (enterpriseId) =>
    set((state) => ({
      currentView: 'enterprises',
      enterpriseOpenRequest: { id: (state.enterpriseOpenRequest?.id ?? 0) + 1, enterpriseId },
    })),
  requestApplyClientFilter: (stage, tagIds) =>
    set((state) => ({
      currentView: 'clients',
      clientFilterRequest: { id: (state.clientFilterRequest?.id ?? 0) + 1, stage, tagIds },
    })),
}));

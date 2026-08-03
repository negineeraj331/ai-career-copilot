import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'system') {
    // Remove the attribute rather than computing the OS value: the CSS media
    // query already handles `system`, and writing a resolved value would freeze
    // the choice if the OS setting changed while the tab was open.
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'cc-theme-store',
      version: 1,
      onRehydrateStorage: () => (state) => {
        // The inline script in index.html sets the attribute before first paint
        // to avoid a flash; this re-applies it once the store is live so both
        // agree.
        if (state) applyTheme(state.theme);
      },
    },
  ),
);

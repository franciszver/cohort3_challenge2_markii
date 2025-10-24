import React, { createContext, useContext, useMemo } from 'react';
import { Appearance } from 'react-native';
import { getFlags } from './flags';

type Theme = {
  colors: {
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    primary: string;
    bubbleMe: string;
    bubbleOther: string;
    border: string;
  };
};

const Light: Theme = {
  colors: {
    background: '#ffffff',
    surface: '#ffffff',
    textPrimary: '#111827',
    textSecondary: '#6b7280',
    primary: '#3b82f6',
    bubbleMe: '#dcf8c6',
    bubbleOther: '#ffffff',
    border: '#e5e7eb',
  },
};

const Dark: Theme = {
  colors: {
    background: '#0b0b0b',
    surface: '#111111',
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    primary: '#60a5fa',
    bubbleMe: '#1f2937',
    bubbleOther: '#111827',
    border: '#1f2937',
  },
};

const ThemeContext = createContext<Theme>(Light);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { ENABLE_THEME } = getFlags();
  const colorScheme = ENABLE_THEME ? Appearance.getColorScheme() : 'light';
  const theme = useMemo(() => (colorScheme === 'dark' ? Dark : Light), [colorScheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}



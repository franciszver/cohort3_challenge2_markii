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
    background: '#F0F9FF',
    surface: '#FFFFFF',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    primary: '#38BDF8',
    bubbleMe: '#E0F2FE',
    bubbleOther: '#FFFFFF',
    border: '#E2E8F0',
  },
};

const Dark: Theme = {
  colors: {
    background: '#0b0b0b',
    surface: '#111111',
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    primary: '#38BDF8',
    bubbleMe: '#1f2937',
    bubbleOther: '#111827',
    border: '#1f2937',
  },
};

const ThemeContext = createContext<Theme>(Light);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { ENABLE_THEME, ENABLE_THEME_SKY } = getFlags();
  const colorScheme = ENABLE_THEME ? Appearance.getColorScheme() : 'light';
  const theme = useMemo(() => {
    // For now, ENABLE_THEME_SKY just swaps the light palette to sky colors (already applied).
    return colorScheme === 'dark' ? Dark : Light;
  }, [colorScheme, ENABLE_THEME_SKY]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}



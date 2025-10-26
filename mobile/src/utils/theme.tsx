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
    // Paper off-white background
    background: '#FAF8F4',
    // Surface like paper sheet
    surface: '#FFFFFF',
    // Pencil lead dark gray for main text
    textPrimary: '#2F2F2F',
    // Softer graphite for secondary text
    textSecondary: '#6B6B6B',
    // Accent resembling pencil graphite highlight
    primary: '#4B5563',
    // Message bubbles akin to light graphite on paper
    bubbleMe: '#F2EFEA',
    bubbleOther: '#FFFFFF',
    // Border like faint pencil line
    border: '#E5E1DA',
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



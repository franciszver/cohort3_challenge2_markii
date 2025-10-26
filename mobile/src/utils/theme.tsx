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
    // Extended tokens for consistent styling
    inputBackground: string;
    modal: string;
    overlay: string; // semi-transparent overlay
    muted: string; // subtle text/skeletons
    link: string;
    success: string;
    danger: string;
    destructive: string;
    buttonPrimaryBg: string;
    buttonPrimaryText: string;
    accent: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  radii: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
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
    textSecondary: '#4A4A4A',
    // Accent resembling pencil graphite highlight
    primary: '#4B5563',
    // Message bubbles with stronger differentiation
    bubbleMe: '#E6F4EA',
    bubbleOther: '#E7F0FF',
    // Border like faint pencil line
    border: '#E5E1DA',
    // Extended
    inputBackground: '#FFFFFF',
    modal: '#FFFFFF',
    overlay: 'rgba(0,0,0,0.4)',
    muted: '#6b7280',
    link: '#2563eb',
    success: '#16a34a',
    danger: '#ef4444',
    destructive: '#ef4444',
    buttonPrimaryBg: '#F2EFEA',
    buttonPrimaryText: '#2F2F2F',
    accent: '#22c55e',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radii: { sm: 6, md: 8, lg: 12, xl: 16, full: 9999 },
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
    inputBackground: '#0f0f0f',
    modal: '#181818',
    overlay: 'rgba(0,0,0,0.6)',
    muted: '#6b7280',
    link: '#60a5fa',
    success: '#22c55e',
    danger: '#f87171',
    destructive: '#f87171',
    buttonPrimaryBg: '#1f2937',
    buttonPrimaryText: '#e5e7eb',
    accent: '#22c55e',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radii: { sm: 6, md: 8, lg: 12, xl: 16, full: 9999 },
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



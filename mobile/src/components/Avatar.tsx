import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export function colorForId(id: string): string {
  const palette = [
    '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316', '#14b8a6', '#e11d48', '#22c55e', '#a855f7', '#f43f5e', '#0ea5e9', '#65a30d', '#fb7185'
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    // simple 32-bit hash
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % palette.length;
  return palette[idx];
}

type Props = {
  userId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  color?: string;
  size?: number;
  onPress?: () => void;
};

export default function Avatar({ userId, firstName, lastName, email, color, size = 32, onPress }: Props) {
  const initials = (() => {
    const a = (firstName || '').trim();
    const b = (lastName || '').trim();
    if (a || b) return `${a.slice(0,1)}${b.slice(0,1)}`.toUpperCase() || '?';
    const local = (email || '').split('@')[0] || '';
    if (local) return local.slice(0, 2).toUpperCase();
    return '??';
  })();
  const bg = color || colorForId(userId || email || initials);
  // debug logs removed
  const content = (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}> 
      <Text style={[styles.text, { fontSize: Math.max(10, Math.floor(size * 0.4)) }]}>{initials}</Text>
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  return content;
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: 'white', fontWeight: '700' },
});



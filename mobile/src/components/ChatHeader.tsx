import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

type Props = { username: string; avatar?: string; online?: boolean; subtitle?: string };

export default function ChatHeader({ username, avatar, online, subtitle }: Props) {
  return (
    <View style={styles.container}>
      <View style={{ position: 'relative' }}>
        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.placeholder} />}
        <View style={[styles.presenceDot, { backgroundColor: online ? '#22c55e' : '#9ca3af' }]} />
      </View>
      <View>
        <Text style={styles.username}>{username}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff' },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  placeholder: { width: 32, height: 32, borderRadius: 16, marginRight: 8, backgroundColor: '#ddd' },
  presenceDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, right: 4, bottom: 4, borderWidth: 2, borderColor: '#fff' },
  username: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 12, color: '#6b7280' },
});

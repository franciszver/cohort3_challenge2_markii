import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import { getFlags } from '../utils/flags';
import { useTheme } from '../utils/theme';

type Props = {
  username: string;
  avatar?: string;
  online?: boolean;
  subtitle?: string;
  profile?: { userId: string; firstName?: string; lastName?: string; email?: string; avatarColor?: string };
};

export default function ChatHeader({ username, avatar, online, subtitle, profile }: Props) {
  const { ENABLE_PROFILES } = getFlags();
  const theme = useTheme();
  const [showProfile, setShowProfile] = useState(false);
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }] }>
      {ENABLE_PROFILES && profile?.email ? (
        <View style={{ position: 'relative' }}>
          <Avatar userId={profile.userId} firstName={profile.firstName} lastName={profile.lastName} email={profile.email} color={profile.avatarColor || undefined} size={32} onPress={() => setShowProfile(true)} />
          <View style={[styles.presenceDot, { backgroundColor: online ? '#22c55e' : '#9ca3af' }]} />
        </View>
      ) : (
        <View style={{ position: 'relative' }}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={styles.placeholder} />}
          <View style={[styles.presenceDot, { backgroundColor: online ? '#22c55e' : '#9ca3af' }]} />
        </View>
      )}
      <View>
        <Text style={styles.username}>{(() => {
          if (ENABLE_PROFILES && profile) {
            const full = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
            if (full) return full;
            if (profile.email) return profile.email;
          }
          return username;
        })()}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <ProfileModal visible={!!(ENABLE_PROFILES && showProfile)} onClose={() => setShowProfile(false)} user={profile && profile.email ? { userId: profile.userId, firstName: profile.firstName, lastName: profile.lastName, email: profile.email!, avatarColor: profile.avatarColor } : null} />
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

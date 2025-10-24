import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getFlags } from '../utils/flags';

export default function OfflineBanner({ onRetry }: { onRetry?: () => void }) {
  const { ENABLE_OFFLINE_BANNER } = getFlags();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (!ENABLE_OFFLINE_BANNER) return;
    const sub = NetInfo.addEventListener((state) => {
      try {
        const offline = state.isConnected === false || state.isInternetReachable === false;
        setIsOffline(!!offline);
      } catch {}
    });
    return () => { try { sub(); } catch {} };
  }, [ENABLE_OFFLINE_BANNER]);

  if (!ENABLE_OFFLINE_BANNER || !isOffline) return null;
  return (
    <View style={{ backgroundColor: '#0ea5e9', padding: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: 'white', fontWeight: '600' }}>You’re offline</Text>
        {onRetry ? (
          <TouchableOpacity onPress={onRetry} accessibilityLabel="Retry network action">
            <Text style={{ color: 'white', fontWeight: '600', textDecorationLine: 'underline' }}>Retry</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}



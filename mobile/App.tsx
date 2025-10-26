import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { ThemeProvider } from './src/utils/theme';
import ErrorBoundary from './src/components/ErrorBoundary';
import { createStackNavigator } from '@react-navigation/stack';
import AuthScreen from './src/screens/AuthScreen';
import VerifyCodeScreen from './src/screens/VerifyCodeScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import ConversationListScreen from './src/screens/ConversationListScreen';
import GroupCreateScreen from './src/screens/GroupCreateScreen';
import ForgotPasswordRequestScreen from './src/screens/ForgotPasswordRequestScreen';
import ForgotPasswordCodeScreen from './src/screens/ForgotPasswordCodeScreen';
import ForgotPasswordNewPasswordScreen from './src/screens/ForgotPasswordNewPasswordScreen';
import ForgotPasswordLinearScreen from './src/screens/ForgotPasswordLinearScreen';
import * as Notifications from 'expo-notifications';
import { getFlags } from './src/utils/flags';
import Constants from 'expo-constants';
import { getCurrentUser } from 'aws-amplify/auth';
import { updateMyPushToken } from './src/graphql/users';

const Stack = createStackNavigator();

export default function App() {
  const navRef = useNavigationContainerRef();
  useEffect(() => {
    (async () => {
      try {
        if (getFlags().DEBUG_LOGS) console.log('[push] requesting permissions');
        const { status } = await Notifications.requestPermissionsAsync();
        if (getFlags().DEBUG_LOGS) console.log('[push] permission status', status);
        // Always set handler for local notifications
        const { ENABLE_NOTIFICATIONS_UX } = getFlags();
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            // Prefer new fields over deprecated shouldShowAlert
            shouldShowBanner: true,
            shouldShowList: true,
            shouldShowAlert: true,
            shouldPlaySound: false,
            shouldSetBadge: !!ENABLE_NOTIFICATIONS_UX,
          } as any),
        });

        // Skip remote push registration in Expo Go or when projectId is missing
        const appOwnership = (Constants as any)?.appOwnership;
        const projectId = (Constants as any)?.expoConfig?.extra?.eas?.projectId || (Constants as any)?.easConfig?.projectId;
        const canRegisterRemote = status === 'granted' && projectId && appOwnership !== 'expo';
        if (!canRegisterRemote) {
          console.log('[push] skipping remote push registration (Expo Go or missing projectId)');
          return;
        }

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (getFlags().DEBUG_LOGS) console.log('[push] expo token', token);
        try {
          const me = await getCurrentUser();
          if (getFlags().DEBUG_LOGS) console.log('[push] updating token for user', me.userId);
          await updateMyPushToken(me.userId, token);
          if (getFlags().DEBUG_LOGS) console.log('[push] update token success');
        } catch (e) {
          if (getFlags().DEBUG_LOGS) console.log('[push] update token error', (e as any)?.message || String(e));
        }
      } catch (e) {
        if (getFlags().DEBUG_LOGS) console.log('[push] error', (e as any)?.message || String(e));
      }
      const sub = Notifications.addNotificationResponseReceivedListener((response) => {
        try {
          const data: any = response?.notification?.request?.content?.data || {};
          const conversationId = data?.conversationId;
          if (getFlags().DEBUG_LOGS) console.log('[push] tap received', { conversationId });
          if (conversationId) navRef.navigate('Chat' as never, { conversationId } as never);
        } catch (e) {
          console.log('[push] tap handler error', (e as any)?.message || String(e));
        }
      });
      return () => { try { sub.remove(); } catch {} };
    })();
  }, []);

  return (
    <ThemeProvider>
      <NavigationContainer ref={navRef}>
        <ErrorBoundary>
          <Stack.Navigator initialRouteName="Auth">
            <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
            <Stack.Screen name="VerifyCode" component={VerifyCodeScreen} options={{ title: 'Verify Code' }} />
            <Stack.Screen name="ForgotPasswordRequest" component={ForgotPasswordRequestScreen} />
            <Stack.Screen name="ForgotPasswordCode" component={ForgotPasswordCodeScreen} />
            <Stack.Screen name="ForgotPasswordNew" component={ForgotPasswordNewPasswordScreen} />
            <Stack.Screen name="ForgotPasswordLinear" component={ForgotPasswordLinearScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Conversations" component={ConversationListScreen} options={{ title: 'Conversations', headerTitleAlign: 'center' }} />
            <Stack.Screen name="GroupCreate" component={GroupCreateScreen} options={{ title: 'Start a chat' }} />
            <Stack.Screen name="Chat" component={ChatScreen} />
          </Stack.Navigator>
        </ErrorBoundary>
      </NavigationContainer>
    </ThemeProvider>
  );
}

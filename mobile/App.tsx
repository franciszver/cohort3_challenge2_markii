import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AuthScreen from './src/screens/AuthScreen';
import VerifyCodeScreen from './src/screens/VerifyCodeScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import ForgotPasswordRequestScreen from './src/screens/ForgotPasswordRequestScreen';
import ForgotPasswordCodeScreen from './src/screens/ForgotPasswordCodeScreen';
import ForgotPasswordNewPasswordScreen from './src/screens/ForgotPasswordNewPasswordScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Auth">
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="VerifyCode" component={VerifyCodeScreen} />
        <Stack.Screen name="ForgotPasswordRequest" component={ForgotPasswordRequestScreen} />
        <Stack.Screen name="ForgotPasswordCode" component={ForgotPasswordCodeScreen} />
        <Stack.Screen name="ForgotPasswordNew" component={ForgotPasswordNewPasswordScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

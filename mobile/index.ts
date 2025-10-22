import 'react-native-gesture-handler';
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';
import { configureAmplify } from './src/aws';
import App from './App';

// Configure Amplify early (clients are now lazily created, so static imports are safe)
configureAmplify();

// Register the root component synchronously so Expo can find the "main" entry
registerRootComponent(App);

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { NavigationContainer } from '@react-navigation/native';
import App from './app/_layout';

registerRootComponent(() => (
  <NavigationContainer>
    <home />
  </NavigationContainer>
));

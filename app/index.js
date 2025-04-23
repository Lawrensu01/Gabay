import { View, Image, ActivityIndicator } from 'react-native';
import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from 'react-native-responsive-screen';

export default function StartPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/signIn'); // Navigate to SignIn after 3 seconds
    }, 3000);

    return () => clearTimeout(timer); // Cleanup timer
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white' }}>
      {/* Logo */}
      <Image 
        source={require('../assets/images/gabaylogo.png')} 
        style={{ height: hp(50), marginTop:-hp(15), resizeMode: 'contain' }}
      />

      {/* Loading Indicator */}
      <ActivityIndicator size="large" color="#40B59F" style={{ marginTop: hp(5) }} />
    </View>
  );
}

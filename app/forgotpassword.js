import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, Image, Pressable } from 'react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { AntDesign, Ionicons } from '@expo/vector-icons';
import { useRouter } from "expo-router";
import { useNavigation } from '@react-navigation/native'; // Import useNavigation
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from 'react-native-responsive-screen';

export default function ForgotPasswordScreen() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const navigation = useNavigation(); // Use useNavigation hook for navigation

    const handleResetPassword = async () => {
        if (!email) {
            Alert.alert("Error", "Please enter your registered email.");
            return;
        }

        setLoading(true);
        try {
            await sendPasswordResetEmail(auth, email);
            Alert.alert("Success", "Password reset link sent to your email.");
            router.push('/signIn'); // Use router.push to navigate to signIn
        } catch (error) {
            Alert.alert("Error", "Invalid or unregistered email.");
            console.error("Reset Error:", error);
        }
        setLoading(false);
    };

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'white' }}>
            {/* 🔹 Fixed Back Button */}
            <Pressable 
                onPress={() => {
                    console.log("Back button pressed"); // For debugging
                    navigation.goBack(); // Use navigation.goBack() to go back
                }}
                style={{
                    position: 'absolute',
                    top: 50,
                    left: 20,
                    flexDirection: 'row',
                    alignItems: 'center',
                    zIndex: 10 // Ensures it is on top of other components
                }}
            >
                <Ionicons name="arrow-back" size={24} color="#40B59F" />
                <Text style={{ color: "#40B59F", fontSize: 18, marginLeft: 5 }}>Back</Text>
            </Pressable>

            {/* 🔹 Gabay Logo */}
            <Image 
                style={{ height: hp(50), marginTop: -hp(15) }} 
                resizeMode='contain' 
                source={require('../assets/images/gabaylogo.png')} 
            />

            <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#40B59F', marginBottom: 20 }}>Forgot Password</Text>
            
            <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
                style={{
                    width: '100%',
                    borderBottomWidth: 1,
                    borderBottomColor: '#40B59F',
                    padding: 10,
                    fontSize: 16,
                    marginBottom: 20
                }}
            />

            {/* 🔹 Send Reset Link Button */}
            <TouchableOpacity
                onPress={handleResetPassword}
                style={{
                    backgroundColor: '#40B59F',
                    paddingVertical: 12,
                    paddingHorizontal: 30,
                    borderRadius: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
                disabled={loading}
            >
                {loading ? <ActivityIndicator color="white" /> : <AntDesign name="mail" size={20} color="white" />}
                <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginLeft: 10 }}>
                    {loading ? "Sending..." : "Send Reset Link"}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

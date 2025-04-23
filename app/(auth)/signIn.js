import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from "expo-router";
import { useAuth } from "../../context/authContext";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from 'react-native-responsive-screen';
import { doc, setDoc, getDoc } from '../../firebaseConfig';
import { db } from '../../firebaseConfig';

export default function SignIn() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const router = useRouter();

    const handleLogin = async () => {
        try {
            setLoading(true);
            const response = await login(email, password);
            if (response.success) {
                // Check if it's admin email
                if (email === 'admin@gabay.com') {
                    // Set or update admin status in Firestore
                    const userRef = doc(db, 'users', response.data.user.uid);
                    const userDoc = await getDoc(userRef);
                    
                    if (!userDoc.exists()) {
                        // Create new user document with admin privileges
                        await setDoc(userRef, {
                            email: email,
                            isAdmin: true,
                            userID: response.data.user.uid
                        });
                    } else {
                        // Update existing user document with admin privileges
                        await setDoc(userRef, {
                            ...userDoc.data(),
                            isAdmin: true
                        }, { merge: true });
                    }
                }
                router.replace('home');
            } else {
                Alert.alert('Error', response.msg);
            }
        } catch (error) {
            console.error('Login error:', error);
            Alert.alert('Error', 'Failed to login');
        } finally {
            setLoading(false);
        }
    };

    // Rest of your component code...
} 
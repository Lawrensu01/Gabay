import { View, TextInput, Image, Text, TouchableOpacity, Pressable, Alert, StyleSheet } from 'react-native';
import React, { useState, useEffect } from 'react';
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from 'react-native-responsive-screen';
import { StatusBar } from 'expo-status-bar';
import AntDesign from '@expo/vector-icons/AntDesign';
import { useRouter } from "expo-router";
import { useAuth } from "../context/authContext";

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: 'white',
        justifyContent: 'center'
    },
    logo: {
        height: hp(50),
        marginTop: -hp(15)
    },
    inputContainer: {
        width: wp(90),
        gap: hp(1.5),
        marginBottom: hp(3)
    },
    inputWrapper: {
        height: hp(7),
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "#f5f5f5",
        borderRadius: 15,
        paddingHorizontal: 20
    },
    input: {
        flex: 1,
        fontSize: hp(2),
        marginLeft: 10,
        color: "#333"
    },
    forgotPassword: {
        flexDirection: "row",
        justifyContent: "flex-end"
    },
    forgotPasswordText: {
        color: "#40B59F",
        fontWeight: "bold",
        marginTop: hp(1)
    },
    signInButton: {
        backgroundColor: "#40B59F",
        paddingVertical: hp(1),
        paddingHorizontal: wp(20),
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 3
    },
    signInButtonText: {
        fontSize: hp(2.5),
        color: "white",
        fontWeight: "bold"
    },
    createAccountContainer: {
        flexDirection: "row",
        justifyContent: "center",
        paddingTop: hp(5)
    },
    createAccountText: {
        color: "black",
        textAlign: "center"
    },
    createAccountLink: {
        color: "#40B59F",
        fontWeight: "bold",
        marginLeft: 5
    }
});

export default function SignIn() {
    const router = useRouter();
    const { login, user } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    useEffect(() => {
        if (user) {
            router.replace('/home'); // Redirect if user is already logged in
        }
    }, [user]);

    const handleLogin = async () => {
        if (!email || !password) {
            Alert.alert('Sign in', "Please fill all fields");
            return;
        }

        const response = await login(email, password);
        if (response.success) {
            router.replace('/home'); // Redirect on successful login
        } else {
            Alert.alert("Login Failed", response.msg);
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* Logo */}
            <Image 
                style={styles.logo} 
                resizeMode='contain' 
                source={require('../assets/images/gabaylogo.png')} 
            />

            {/* Input Fields */}
            <View style={styles.inputContainer}> 

                {/* Email Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="mail" size={hp(2.7)} color="black" />
                    <TextInput
                        value={email}
                        onChangeText={setEmail}
                        style={styles.input}
                        placeholder="Email"
                        placeholderTextColor="gray"
                        keyboardType="email-address"
                        autoCapitalize="none"
                    />
                </View>

                {/* Password Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="lock" size={hp(2.7)} color="black" />
                    <TextInput
                        value={password}
                        onChangeText={setPassword}
                        style={styles.input}
                        placeholder="Password"
                        secureTextEntry
                        placeholderTextColor="gray"
                    />
                </View>

                {/* Forgot Password - Now Clickable */}
                <View style={styles.forgotPassword}>
                    <Pressable onPress={() => router.push('/forgotpassword')}>
                        <Text style={styles.forgotPasswordText}>
                            Forgot my password?
                        </Text>
                    </Pressable>
                </View>
            </View>

            {/* Sign In Button */}
            <TouchableOpacity 
                onPress={handleLogin}
                style={styles.signInButton}
                activeOpacity={0.8}
            >
                <Text style={styles.signInButtonText}>Sign In</Text>
            </TouchableOpacity>

            {/* Create Account */}
            <View style={styles.createAccountContainer}>
                <Text style={styles.createAccountText}>New User?</Text>
                <Pressable onPress={() => router.push('/signUp')}>
                    <Text style={styles.createAccountLink}>Create Account</Text>
                </Pressable>
            </View>
        </View>
    );
}

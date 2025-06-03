import { View, TextInput, Image, Text, TouchableOpacity, Pressable, Alert, StyleSheet } from 'react-native';
import React, { useRef, useState } from 'react';
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from 'react-native-responsive-screen';
import { StatusBar } from 'expo-status-bar';
import AntDesign from '@expo/vector-icons/AntDesign';
import { useRouter } from "expo-router";
import { useAuth } from '../context/authContext';

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: 'white',
        justifyContent: 'center'
    },
    title: {
        fontSize: hp(4)
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
    signUpButton: {
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
    signUpButtonText: {
        fontSize: hp(2.5),
        color: "white",
        fontWeight: "bold"
    },
    signInContainer: {
        flexDirection: "row",
        justifyContent: "center",
        paddingTop: hp(5)
    },
    signInText: {
        color: "black",
        textAlign: "center",
        marginTop: hp(1)
    },
    signInLink: {
        color: "#40B59F",
        textAlign: "center",
        marginTop: hp(1),
        fontWeight: "bold"
    }
});

export default function SignUp() {
    const router = useRouter();
    const { register } = useAuth();
    const mailref = useRef("");
    const passwordref = useRef("");
    const retypePasswordref = useRef("");
    const fnameref = useRef("");
    const lnameref = useRef("");
    const mnameref = useRef("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleRegister = async () => {
        if (!fnameref.current || !lnameref.current || !mailref.current || !passwordref.current || !retypePasswordref.current) {
            Alert.alert('Sign Up', "Please fill all required fields");
            return;
        }

        if (passwordref.current !== retypePasswordref.current) {
            Alert.alert('Sign Up', "Passwords do not match");
            return;
        }

        const response = await register(mailref.current, passwordref.current, fnameref.current, lnameref.current, mnameref.current);

        if (!response.success) {
            Alert.alert('Signup', response.msg);
        }
    }

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View>
                <Text style={styles.title}>Register Here!</Text>
            </View>

            <View style={styles.inputContainer}>
                {/* Firstname Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="user" size={hp(2.7)} color="black" />
                    <TextInput
                        onChangeText={value => fnameref.current = value}
                        style={styles.input}
                        placeholder="First Name"
                        placeholderTextColor="gray"
                    />
                </View>

                {/* Last Name Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="user" size={hp(2.7)} color="black" />
                    <TextInput
                        onChangeText={value => lnameref.current = value}
                        style={styles.input}
                        placeholder="Last Name"
                        placeholderTextColor="gray"
                    />
                </View>

                {/* Middle name Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="user" size={hp(2.7)} color="black" />
                    <TextInput
                        onChangeText={value => mnameref.current = value}
                        style={styles.input}
                        placeholder="Middle Name (Optional)"
                        placeholderTextColor="gray"
                    />
                </View>

                {/* email Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="mail" size={hp(2.7)} color="black" />
                    <TextInput
                        onChangeText={value => mailref.current = value}
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
                        onChangeText={value => passwordref.current = value}
                        style={styles.input}
                        placeholder="Password"
                        secureTextEntry={!showPassword}
                        placeholderTextColor="gray"
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                        <AntDesign 
                            name={showPassword ? "eye" : "eyeo"} 
                            size={hp(2.7)} 
                            color="black" 
                        />
                    </TouchableOpacity>
                </View>

                {/* Confirm Password Input */}
                <View style={styles.inputWrapper}>
                    <AntDesign name="lock" size={hp(2.7)} color="black" />
                    <TextInput
                        onChangeText={value => retypePasswordref.current = value}
                        style={styles.input}
                        placeholder="Confirm Password"
                        secureTextEntry={!showConfirmPassword}
                        placeholderTextColor="gray"
                    />
                    <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                        <AntDesign 
                            name={showConfirmPassword ? "eye" : "eyeo"} 
                            size={hp(2.7)} 
                            color="black" 
                        />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Sign Up Button */}
            <TouchableOpacity
                onPress={handleRegister}
                style={styles.signUpButton}
                activeOpacity={0.8}
            >
                <Text style={styles.signUpButtonText}>Sign Up</Text>
            </TouchableOpacity>

            <View style={styles.signInContainer}>
                <Text style={styles.signInText}>Already have an account?</Text>
                <Pressable onPress={() => router.push('signIn')}>
                    <Text style={styles.signInLink}>Sign In</Text>
                </Pressable>
            </View>
        </View>
    );
}

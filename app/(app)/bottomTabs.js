import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AntDesign, Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import ProfileScreen from './profile';
import AccessibilityMap from './heatmap';
import App from './navigation';
import HomeScreen from './homeScreen';
import AdminPanel from './adminPanel';
import { useAuth } from '../../context/authContext';
import { View, Text, ActivityIndicator } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Tabs } from "expo-router";

const Tab = createBottomTabNavigator();

export default function BottomTabs() {
    const { user, isAdmin } = useAuth();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const checkAdminStatus = async () => {
            if (user) {
                console.log('BottomTabs - Current user:', user.email);
                console.log('BottomTabs - isAdmin from context:', isAdmin);
                
                // Double check admin status in Firestore
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                const userData = userDoc.data();
                console.log('BottomTabs - Admin status from Firestore:', userData?.isAdmin);
            }
        };

        checkAdminStatus();
    }, [user, isAdmin]);

    useEffect(() => {
        const initialize = async () => {
            try {
                // Add any initialization logic here
                setIsLoading(false);
            } catch (err) {
                console.error('Error initializing BottomTabs:', err);
                setError('Failed to initialize app');
                setIsLoading(false);
            }
        };

        initialize();
    }, []);

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#40B59F" />
                <Text style={{ marginTop: 10 }}>Loading...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: 'red', marginBottom: 10 }}>{error}</Text>
                <Text>Please restart the app</Text>
            </View>
        );
    }

    return (
        <Tab.Navigator 
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#40B59F',
                tabBarInactiveTintColor: 'gray',
                tabBarStyle: { height: 60, paddingBottom: 10 }
            }}
        >
            <Tab.Screen 
                name="HomeTab" 
                component={HomeScreen} 
                options={{
                    tabBarLabel: "Home",
                    tabBarIcon: ({ color, size }) => <AntDesign name="home" size={size} color={color} />
                }}
            />
            <Tab.Screen 
                name="Search" 
                component={App} 
                options={{
                    tabBarLabel: "Navigate",
                    tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />
                }}
            />
            <Tab.Screen 
                name="Heatmap" 
                component={AccessibilityMap} 
                options={{
                    tabBarLabel: "Heatmap",
                    tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="fire" size={size} color={color} />
                }}
            />
            {isAdmin && (
                <Tab.Screen 
                    name="Admin" 
                    component={AdminPanel} 
                    options={{
                        tabBarLabel: "Admin",
                        tabBarIcon: ({ color, size }) => <Feather name="settings" size={size} color={color} />
                    }}
                />
            )}
            <Tab.Screen 
                name="Profile" 
                component={ProfileScreen} 
                options={{
                    tabBarLabel: "Profile",
                    tabBarIcon: ({ color, size }) => <AntDesign name="user" size={size} color={color} />
                }}
            />
        </Tab.Navigator>
    );
} 
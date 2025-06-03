import { View, Text, ActivityIndicator } from 'react-native'
import React, { useEffect, useState } from 'react'
import { Slot, useSegments } from "expo-router";
import { useRouter } from "expo-router";
import { AuthContextProvider, useAuth } from '../context/authContext';
import { checkPermissions } from '../utils/permissionsHandler';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MainLayout = () => {
    const { isAuthenticated, isLoading } = useAuth();
    const segments = useSegments();
    const router = useRouter();
    const [permissionsChecked, setPermissionsChecked] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const initialize = async () => {
            try {
                console.log('Auth state:', { isAuthenticated, isLoading });
                await checkInitialPermissions();
            } catch (err) {
                console.error('Initialization error:', err);
                setError(err);
            }
        };
        initialize();
    }, []);

    const checkInitialPermissions = async () => {
        try {
            // Check if we've already shown the permissions screen in this session
            const permissionsShown = await AsyncStorage.getItem('permissionsScreenShown');
            
            if (!permissionsShown) {
                // We'll handle permissions through the dedicated screen
                console.log('First run, will handle permissions through dedicated screen');
                setPermissionsChecked(true);
                return;
            }
            
            // Check actual permission status
            const permissions = await checkPermissions();
            console.log('Permissions status:', permissions);
            
            // Store permission status
            await AsyncStorage.setItem('permissionsStatus', JSON.stringify(permissions));
            setPermissionsChecked(true);
        } catch (error) {
            console.error('Permission check error:', error);
            setPermissionsChecked(true);
        }
    };

    useEffect(() => {
        if (isLoading || !permissionsChecked) return;

        try {
            console.log('Navigation state:', { isAuthenticated, segments, permissionsChecked });
            const inApp = segments[0] === '(app)';
            const permissionsShown = AsyncStorage.getItem('permissionsScreenShown');
            
            if (isAuthenticated) {
                if (!permissionsShown && !inApp) {
                    console.log('Navigating to permissions screen');
                    router.replace('/(auth)/permissions');
                } else if (!inApp) {
                    console.log('Navigating to home');
                    router.replace('/(app)/home');
                }
            } else {
                console.log('Navigating to sign in');
                router.replace('/(auth)/signIn');
            }
        } catch (err) {
            console.error('Navigation error:', err);
            setError(err);
        }
    }, [isAuthenticated, permissionsChecked, isLoading]);

    if (error) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: 'red', marginBottom: 10 }}>Something went wrong</Text>
                <Text>{error.message}</Text>
            </View>
        );
    }

    if (isLoading || !permissionsChecked) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#40B59F" />
                <Text style={{ marginTop: 10 }}>Loading...</Text>
            </View>
        );
    }

    return <Slot />;
};

export default function Layout() {
    return (
        <AuthContextProvider>
            <MainLayout />
        </AuthContextProvider>
    );
}
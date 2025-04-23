import { View, Text, ActivityIndicator } from 'react-native'
import React, { useEffect, useState } from 'react'
import { Slot, useSegments } from "expo-router";
import { useRouter } from "expo-router";
import "../global.css";
import { AuthContextProvider, useAuth } from '../context/authContext';
import { checkPermissions } from '../utils/permissionsHandler';

const MainLayout = ()=>{
    const {isAuthenticated, isLoading} = useAuth();
    const segments = useSegments();
    const router = useRouter();
    const [permissionsChecked, setPermissionsChecked] = useState(false);

    useEffect(() => {
        console.log('Auth state:', { isAuthenticated, isLoading });
        checkInitialPermissions();
    }, []);

    const checkInitialPermissions = async () => {
        try {
            const permissions = await checkPermissions();
            console.log('Permissions:', permissions);
            setPermissionsChecked(true);
            // Temporarily comment out permission check
            // if (!permissions.location || !permissions.camera || !permissions.notifications) {
            //     router.replace('permissions');
            // }
        } catch (error) {
            console.error('Permission check error:', error);
            setPermissionsChecked(true);
        }
    };

    useEffect(() => {
        console.log('Navigation state:', { isAuthenticated, segments, permissionsChecked });
        if (isLoading) return;

        const inApp = segments[0] == '(app)';
        if (isAuthenticated && !inApp && permissionsChecked) {
            console.log('Navigating to home');
            router.replace('home');
        } else if (isAuthenticated === false) {
            console.log('Navigating to sign in');
            router.replace('signIn');
        }
    }, [isAuthenticated, permissionsChecked, isLoading]);

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#40B59F" />
                <Text style={{ marginTop: 10 }}>Loading...</Text>
            </View>
        );
    }

    return <Slot />
}

export default function Layout() {
    return(
        <AuthContextProvider>
            <MainLayout />
        </AuthContextProvider>
    )
}
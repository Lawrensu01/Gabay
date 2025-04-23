import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AntDesign, Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import ProfileScreen from './profile';
import AccessibilityMap from './heatmap';
import App from './navigation';
import HomeScreen from './homeScreen';
import AdminPanel from './adminPanel';
import { useAuth } from '../../context/authContext';

const Tab = createBottomTabNavigator();

export default function BottomTabs() {
    const { user, isAdmin } = useAuth();

    console.log('Current user:', user?.email); // Debug log
    console.log('Is admin:', isAdmin); // Debug log

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
            {(isAdmin || user?.email === 'admin@gabay.com') && (
                <Tab.Screen 
                    name="AdminPanel" 
                    component={AdminPanel} 
                    options={{
                        tabBarLabel: "Admin",
                        tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" size={size} color={color} />
                    }}
                />
            )}
            <Tab.Screen 
                name="ProfileTab" 
                component={ProfileScreen} 
                options={{
                    tabBarLabel: "Profile",
                    tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />
                }}
            />
        </Tab.Navigator>
    );
} 
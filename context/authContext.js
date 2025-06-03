import { createContext, useContext, useEffect, useState } from "react";
import { 
    onAuthStateChanged, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut,
} from "firebase/auth";
import { auth, db } from "../firebaseConfig";
import { doc, setDoc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkPermissions } from "../utils/permissionsHandler";

export const AuthContext = createContext();

export const AuthContextProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [permissionsGranted, setPermissionsGranted] = useState(false);

    // Initialize auth state from AsyncStorage
    useEffect(() => {
        const initializeAuthState = async () => {
            try {
                const cachedUserData = await AsyncStorage.getItem('userData');
                if (cachedUserData) {
                    const userData = JSON.parse(cachedUserData);
                    setUser(userData);
                    setIsAdmin(userData.isAdmin === true);
                }
            } catch (error) {
                console.error('Error loading cached auth state:', error);
            }
        };

        initializeAuthState();
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            try {
                if (firebaseUser) {
                    const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                    const userData = userDoc.exists() ? userDoc.data() : null;

                    const userState = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        ...userData
                    };

                    setUser(userState);
                    setIsAdmin(userData?.isAdmin === true);
                    await AsyncStorage.setItem('userData', JSON.stringify(userState));
                } else {
                    // Only clear if we're sure the user is logged out
                    const cachedUser = await AsyncStorage.getItem('userData');
                    if (!cachedUser) {
                        setUser(null);
                        setIsAdmin(false);
                        await AsyncStorage.removeItem('userData');
                    }
                }
            } catch (error) {
                console.error('Error in auth state change:', error);
                // Keep existing state if there's an error
                const cachedUser = await AsyncStorage.getItem('userData');
                if (cachedUser) {
                    const userData = JSON.parse(cachedUser);
                    setUser(userData);
                    setIsAdmin(userData.isAdmin === true);
                }
            } finally {
                setIsLoading(false);
            }
        });

        return unsubscribe;
    }, []);

    const checkPermissionsStatus = async () => {
        try {
            const permissions = await checkPermissions();
            const allGranted = Object.values(permissions).every(Boolean);
            setPermissionsGranted(allGranted);
            return allGranted;
        } catch (error) {
            console.error('Error checking permissions:', error);
            return false;
        }
    };

    const login = async (email, password) => {
        try {
            const response = await signInWithEmailAndPassword(auth, email, password);
            // Check permissions after successful login
            await checkPermissionsStatus();
            return { success: true };
        } catch (e) {
            let msg = e.message;
            if (msg.includes('(auth/invalid-email)')) msg = 'Invalid email';
            if (msg.includes('(auth/invalid-credential)')) msg = 'Wrong Credentials';
            return { success: false, msg };
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
            await AsyncStorage.removeItem('userData');
            setUser(null);
            return { success: true };
        } catch (e) {
            return { success: false, msg: e.message, error: e };
        }
    };

    const register = async (email, password, fname, lname, mname) => {
        try {
            const response = await createUserWithEmailAndPassword(auth, email, password);
            console.log('User registered: ', response?.user);

            await setDoc(doc(db, "users", response?.user?.uid), {
                fname,
                lname,
                mname,
                userID: response?.user?.uid
            });

            return { success: true, data: response?.user };
        } catch (e) {
            let msg = e.message;
            if (msg.includes('auth/invalid-email')) msg = 'Invalid Email';
            return { success: false, msg };
        }
    };

    return (
        <AuthContext.Provider value={{ 
            user, 
            isAdmin, 
            login, 
            register, 
            logout,
            isAuthenticated: !!user,
            isLoading,
            checkPermissionsStatus,
            permissionsGranted
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const value = useContext(AuthContext);
    if (!value) {
        throw new Error("useAuth must be used inside AuthContextProvider");
    }
    return value;
};

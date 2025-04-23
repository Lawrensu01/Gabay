import React, { useEffect, useState } from 'react';
import { 
    View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, Image, ScrollView 
} from 'react-native';
import { useAuth } from '../../context/authContext';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import * as ImagePicker from 'expo-image-picker';
import { AntDesign, Entypo, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';


export default function Profile() {
    const { user, logout } = useAuth();
    const navigation = useNavigation();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [retrying, setRetrying] = useState(false);
    
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [middleName, setMiddleName] = useState('');
    const [profileImage, setProfileImage] = useState(null);
    const [address, setAddress] = useState('');
    const [age, setAge] = useState('');

    useEffect(() => {
        if (!user) {
            Alert.alert(
                "Authentication Error",
                "You're not signed in. Please sign in to access your profile.",
                [
                    {
                        text: "OK",
                        onPress: handleLogout
                    }
                ]
            );
            return;
        }
    }, [user]);

    useEffect(() => {
        const fetchUserProfile = async () => {
            try {
                if (!user) {
                    setLoading(false);
                    return;
                }
                
                const userDocRef = doc(db, "users", user.uid);
                const userDoc = await getDoc(userDocRef);

                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    setFirstName(userData.fname || '');
                    setLastName(userData.lname || '');
                    setMiddleName(userData.mname || '');
                    setProfileImage(userData.profileImage || null);
                    setAddress(userData.address || '');
                    setAge(userData.age ? userData.age.toString() : '');
                } else {
                    console.log('No profile document found for user:', user.uid);
                }
            } catch (error) {
                console.error('Error fetching profile:', error);
                Alert.alert("Error", "Failed to load profile data");
            } finally {
                setLoading(false);
            }
        };

        fetchUserProfile();
    }, [user]);

    const handleImagePick = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7,
                base64: true,
            });

            if (!result.canceled) {
                setProfileImage(result.assets[0].uri);
            }
        } catch (error) {
            Alert.alert("Error", "Failed to pick image");
        }
    };

    const handleTakePicture = async () => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7,
                base64: true,
            });

            if (!result.canceled) {
                setProfileImage(result.assets[0].uri);
            }
        } catch (error) {
            Alert.alert("Error", "Failed to take picture");
        }
    };

    const handleSave = async () => {
        if (!firstName || !lastName || !age || !address) {
            Alert.alert("Error", "All fields except Middle Name are required!");
            return;
        }

        setSaving(true);

        try {
            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, {
                fname: firstName,
                lname: lastName,
                mname: middleName,
                profileImage: profileImage,
                address: address,
                age: parseInt(age, 10)
            });

            Alert.alert("Success", "Profile updated successfully!");
        } catch (error) {
            Alert.alert("Error", "Failed to update profile.");
        }

        setSaving(false);
    };

    const handleLogout = async () => {
        try {
          await logout();
          router.replace('/signIn');
        } catch (error) {
          console.error('Error logging out:', error);
          Alert.alert('Error', 'Failed to logout. Please try again.');
        }
      };

    const handleRetry = () => {
        setLoading(true);
        setRetrying(true);
        fetchUserProfile().finally(() => setRetrying(false));
    };

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#40B59F" />
                <Text>Loading profile...</Text>
                {retrying && (
                    <TouchableOpacity 
                        style={{ 
                            marginTop: 20, 
                            padding: 10, 
                            backgroundColor: '#40B59F', 
                            borderRadius: 5 
                        }}
                        onPress={handleRetry}
                    >
                        <Text style={{ color: 'white' }}>Retry</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.headerText}>Edit Profile</Text>

            {/* Profile Image Section - Made more compact */}
            <View style={styles.imageContainer}>
                <View style={styles.imageWrapper}>
                    <Image 
                        source={{ 
                            uri: profileImage || "https://via.placeholder.com/100"
                        }} 
                        style={styles.profileImage} 
                    />
                    <View style={styles.imageButtonsContainer}>
                        <TouchableOpacity style={styles.imageButton} onPress={handleImagePick}>
                            <Entypo name="upload" size={16} color="white" />
                            <Text style={styles.buttonText}>Upload</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.imageButton} onPress={handleTakePicture}>
                            <Entypo name="camera" size={16} color="white" />
                            <Text style={styles.buttonText}>Camera</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Input Fields - More compact */}
            <View style={styles.formContainer}>
                <ProfileField label="First Name" value={firstName} setValue={setFirstName} />
                <ProfileField label="Last Name" value={lastName} setValue={setLastName} />
                <ProfileField label="Middle Name (Optional)" value={middleName} setValue={setMiddleName} />
                <ProfileField label="Address" value={address} setValue={setAddress} />
                <ProfileField label="Age" value={age} setValue={setAge} keyboardType="numeric" />
            </View>

            {/* Buttons */}
            <View style={styles.buttonContainer}>
                <TouchableOpacity 
                    style={[styles.saveButton, saving && styles.disabledButton]} 
                    onPress={handleSave} 
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <>
                            <AntDesign name="save" size={20} color="white" />
                            <Text style={styles.saveButtonText}>Save Changes</Text>
                        </>
                    )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                    <AntDesign name="logout" size={18} color="white" />
                    <Text style={styles.logoutButtonText}>Logout</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

// **📌 Reusable Profile Field Component**
const ProfileField = ({ label, value, setValue, keyboardType = "default" }) => {
    return (
        <View style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
                value={value}
                onChangeText={setValue}
                style={styles.input}
                keyboardType={keyboardType}
                maxLength={label === "Age" ? 3 : 100}
                placeholder={`Enter ${label}`}
                placeholderTextColor="#999"
            />
        </View>
    );
};

// Updated styles for a more compact layout
const styles = {
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
        paddingTop: 40,
        paddingHorizontal: 20,
        justifyContent: 'space-between', // This helps distribute space
    },
    headerText: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#2C3E50',
        textAlign: 'center',
        marginBottom: 10,
    },
    imageContainer: {
        alignItems: 'center',
        marginBottom: 10,
    },
    imageWrapper: {
        alignItems: 'center',
    },
    profileImage: {
        width: 100, // Smaller size
        height: 100, // Smaller size
        borderRadius: 50,
        borderWidth: 2,
        borderColor: '#40B59F',
    },
    imageButtonsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 5,
        gap: 10,
    },
    imageButton: {
        backgroundColor: '#40B59F',
        padding: 6,
        borderRadius: 15,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        gap: 4,
    },
    buttonText: {
        color: 'white',
        fontSize: 11,
        fontWeight: '600',
    },
    formContainer: {
        backgroundColor: 'white',
        padding: 12,
        borderRadius: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        marginBottom: 10,
    },
    fieldContainer: {
        marginBottom: 8,
    },
    fieldLabel: {
        fontSize: 11,
        color: '#666',
        marginBottom: 2,
        fontWeight: '600',
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 6,
        fontSize: 13,
        color: "#333",
        backgroundColor: '#f9f9f9',
        height: 32,
    },
    buttonContainer: {
        gap: 8,
        marginBottom: 80, // Space for bottom tab bar
    },
    saveButton: {
        backgroundColor: '#40B59F',
        padding: 10,
        borderRadius: 10,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
    },
    disabledButton: {
        opacity: 0.7,
    },
    saveButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
    },
    logoutButton: {
        backgroundColor: '#e74c3c',
        padding: 10,
        borderRadius: 10,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
    },
    logoutButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
    },
};

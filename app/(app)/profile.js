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
                quality: 0.5,
                base64: true,
            });

            if (!result.canceled) {
                const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
                setProfileImage(base64Image);
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
                quality: 0.5,
                base64: true,
            });

            if (!result.canceled) {
                const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
                setProfileImage(base64Image);
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
            console.error('Error updating profile:', error);
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
        <ScrollView 
            style={styles.container}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
        >
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
        </ScrollView>
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
        backgroundColor: '#F8F9FA',
        paddingTop: 50,
        paddingHorizontal: 24,
    },
    headerText: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1A1A1A',
        textAlign: 'center',
        marginBottom: 24,
    },
    imageContainer: {
        alignItems: 'center',
        marginBottom: 32,
    },
    imageWrapper: {
        alignItems: 'center',
        position: 'relative',
    },
    profileImage: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 3,
        borderColor: '#40B59F',
        backgroundColor: '#E8E8E8',
    },
    imageButtonsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        gap: 12,
    },
    imageButton: {
        backgroundColor: '#40B59F',
        padding: 8,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        gap: 6,
        shadowColor: '#40B59F',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    buttonText: {
        color: 'white',
        fontSize: 13,
        fontWeight: '600',
    },
    formContainer: {
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 4,
        marginBottom: 24,
    },
    fieldContainer: {
        marginBottom: 16,
    },
    fieldLabel: {
        fontSize: 13,
        color: '#4A4A4A',
        marginBottom: 6,
        fontWeight: '600',
    },
    input: {
        borderWidth: 1,
        borderColor: '#E0E0E0',
        borderRadius: 12,
        padding: 12,
        fontSize: 15,
        color: "#1A1A1A",
        backgroundColor: '#FAFAFA',
        height: 48,
    },
    buttonContainer: {
        gap: 12,
        marginBottom: 32,
    },
    saveButton: {
        backgroundColor: '#40B59F',
        padding: 16,
        borderRadius: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
        shadowColor: '#40B59F',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    disabledButton: {
        opacity: 0.7,
    },
    saveButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    logoutButton: {
        backgroundColor: '#FF4B4B',
        padding: 16,
        borderRadius: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
        shadowColor: '#FF4B4B',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    logoutButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
};

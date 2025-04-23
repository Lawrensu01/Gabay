import React, { useEffect, useState } from 'react';
import { View, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/authContext';

export default function CustomHeader() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [profileImage, setProfileImage] = useState(null);

  useEffect(() => {
    const fetchProfileImage = async () => {
      if (!user) return;
      
      try {
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          setProfileImage(userDoc.data().profileImage);
        }
      } catch (error) {
        console.error('Error fetching profile image:', error);
      }
    };

    fetchProfileImage();
  }, [user]);

  return (
    <View style={styles.header}>
      <TouchableOpacity 
        onPress={() => navigation.navigate('ProfileTab')}
        style={styles.profileImageContainer}
      >
        <Image
          source={{ 
            uri: profileImage || "https://via.placeholder.com/100"
          }}
          style={styles.profileImage}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 1000,
  },
  profileImageContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#40B59F',
  },
  profileImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
}); 
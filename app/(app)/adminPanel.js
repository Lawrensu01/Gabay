import React, { useState, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Image,
    Alert,
    ActivityIndicator,
    RefreshControl,
    Animated,
    PanResponder,
    Dimensions
} from 'react-native';
import { useAuth } from '../../context/authContext';
import { collection, query, where, getDocs, updateDoc, doc, getDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

export default function AdminPanel() {
    const [pendingFeedback, setPendingFeedback] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { user, isAdmin } = useAuth();
    const navigation = useNavigation();
    const [imageLoading, setImageLoading] = useState({});
    const [approvedFeedback, setApprovedFeedback] = useState([]);
    const [swipeableRefs, setSwipeableRefs] = useState({});
    const [activeTab, setActiveTab] = useState('pending'); // 'pending' or 'approved'
    const pan = useRef(new Animated.ValueXY()).current;
    const screenWidth = Dimensions.get('window').width;

    const fetchPendingFeedback = async () => {
        try {
            setLoading(true);
            const feedbackRef = collection(db, 'accessibility_feedback');
            const q = query(feedbackRef, where('status', '==', 'pending'));
            const querySnapshot = await getDocs(q);
            
            const feedbacks = querySnapshot.docs.map(docSnapshot => {
                const feedback = docSnapshot.data();
                return {
                    id: docSnapshot.id,
                    ...feedback,
                    userEmail: feedback.userEmail || 'Unknown User'
                };
            });
            
            setPendingFeedback(feedbacks);
        } catch (error) {
            console.error('Error fetching feedback:', error);
            Alert.alert('Error', 'Failed to load pending feedback');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const fetchApprovedFeedback = async () => {
        try {
            const feedbackRef = collection(db, 'accessibility_feedback');
            const q = query(feedbackRef, where('status', '==', 'approved'));
            const querySnapshot = await getDocs(q);
            
            const feedbacks = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            setApprovedFeedback(feedbacks);
        } catch (error) {
            console.error('Error fetching approved feedback:', error);
            Alert.alert('Error', 'Failed to load approved feedback');
        }
    };

    useFocusEffect(
        React.useCallback(() => {
            fetchPendingFeedback();
            fetchApprovedFeedback();
            return () => {};
        }, [])
    );

    const handleApproveFeedback = async (feedbackId) => {
        try {
            const feedbackDoc = await getDoc(doc(db, 'accessibility_feedback', feedbackId));
            const newFeedback = feedbackDoc.data();
            
            // Check for existing feedback within 3 meters
            const feedbackRef = collection(db, 'accessibility_feedback');
            const approvedFeedbackQuery = query(feedbackRef, where('status', '==', 'approved'));
            const querySnapshot = await getDocs(approvedFeedbackQuery);
            
            let existingNearbyFeedback = null;
            querySnapshot.forEach(doc => {
                const feedback = doc.data();
                const distance = calculateDistance(
                    newFeedback.coordinate,
                    feedback.coordinate
                );
                
                if (distance < 3) {
                    existingNearbyFeedback = {
                        id: doc.id,
                        ...feedback
                    };
                }
            });

            if (existingNearbyFeedback) {
                Alert.alert(
                    "Existing Feedback Found",
                    "There is already approved feedback for this location. Do you want to override it?",
                    [
                        {
                            text: "Cancel",
                            style: "cancel"
                        },
                        {
                            text: "Override",
                            style: "destructive",
                            onPress: async () => {
                                try {
                                    await deleteDoc(doc(db, 'accessibility_feedback', existingNearbyFeedback.id));
                                    await updateDoc(doc(db, 'accessibility_feedback', feedbackId), {
                                        status: 'approved',
                                        reviewedBy: user.uid,
                                        reviewedAt: new Date().toISOString()
                                    });

                                    // Create notification data
                                    const notificationData = {
                                        title: 'Feedback Updated',
                                        body: 'Previous feedback has been overridden with new accessibility information',
                                        timestamp: new Date().toISOString(),
                                        type: 'feedback_updated',
                                        status: 'unread',
                                        feedbackId: feedbackId,
                                        previousFeedbackId: existingNearbyFeedback.id
                                    };

                                    // Create notification document
                                    const notificationRef = await addDoc(collection(db, 'notifications'), notificationData);

                                    // Get all users with their push tokens
                                    const usersRef = collection(db, 'users');
                                    const usersSnapshot = await getDocs(usersRef);

                                    // Send push notifications to all users with tokens
                                    const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
                                        const userData = userDoc.data();
                                        if (userData.expoPushToken && userDoc.id !== user.uid) { // Don't send to self
                                            try {
                                                await fetch('https://exp.host/--/api/v2/push/send', {
                                                    method: 'POST',
                                                    headers: {
                                                        'Accept': 'application/json',
                                                        'Content-Type': 'application/json',
                                                    },
                                                    body: JSON.stringify({
                                                        to: userData.expoPushToken,
                                                        title: notificationData.title,
                                                        body: notificationData.body,
                                                        data: {
                                                            ...notificationData,
                                                            notificationId: notificationRef.id
                                                        },
                                                    }),
                                                });
                                            } catch (error) {
                                                console.error('Error sending push notification to user:', error);
                                            }
                                        }
                                    });

                                    await Promise.all(notificationPromises);
                                    
                                    Alert.alert(
                                        "Success", 
                                        "Previous feedback overridden and new feedback approved",
                                        [
                                            {
                                                text: "OK",
                                                onPress: () => {
                                                    fetchPendingFeedback();
                                                    navigation.navigate('(app)', { screen: 'AccessibilityMap' });
                                                }
                                            }
                                        ]
                                    );
                                } catch (error) {
                                    console.error('Error overriding feedback:', error);
                                    Alert.alert("Error", "Failed to override feedback");
                                }
                            }
                        }
                    ]
                );
            } else {
                // No existing feedback, proceed with normal approval
                await updateDoc(doc(db, 'accessibility_feedback', feedbackId), {
                    status: 'approved',
                    reviewedBy: user.uid,
                    reviewedAt: new Date().toISOString()
                });

                // Create notification data
                const notificationData = {
                    title: 'New Feedback Approved',
                    body: `A new ${newFeedback.type} accessibility location has been approved`,
                    timestamp: new Date().toISOString(),
                    type: 'feedback_approved',
                    status: 'unread',
                    feedbackId: feedbackId
                };

                // Create notification document
                const notificationRef = await addDoc(collection(db, 'notifications'), notificationData);

                // Get all users with their push tokens
                const usersRef = collection(db, 'users');
                const usersSnapshot = await getDocs(usersRef);

                // Send push notifications to all users with tokens
                const notificationPromises = usersSnapshot.docs.map(async (userDoc) => {
                    const userData = userDoc.data();
                    if (userData.expoPushToken && userDoc.id !== user.uid) { // Don't send to self
                        try {
                            await fetch('https://exp.host/--/api/v2/push/send', {
                                method: 'POST',
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    to: userData.expoPushToken,
                                    title: notificationData.title,
                                    body: notificationData.body,
                                    data: {
                                        ...notificationData,
                                        notificationId: notificationRef.id
                                    },
                                }),
                            });
                        } catch (error) {
                            console.error('Error sending push notification to user:', error);
                        }
                    }
                });

                await Promise.all(notificationPromises);

                Alert.alert(
                    "Success", 
                    "Feedback approved",
                    [
                        {
                            text: "OK",
                            onPress: () => {
                                fetchPendingFeedback();
                                navigation.navigate('(app)', { screen: 'AccessibilityMap' });
                            }
                        }
                    ]
                );
            }
        } catch (error) {
            console.error('Error approving feedback:', error);
            Alert.alert("Error", "Failed to approve feedback");
        }
    };

    const handleRejectFeedback = async (feedbackId) => {
        try {
            Alert.alert(
                "Reject Feedback",
                "Are you sure you want to reject this feedback? This action cannot be undone.",
                [
                    {
                        text: "Cancel",
                        style: "cancel"
                    },
                    {
                        text: "Reject",
                        style: "destructive",
                        onPress: async () => {
                            try {
                                // Delete the feedback completely instead of just marking as rejected
                                await deleteDoc(doc(db, 'accessibility_feedback', feedbackId));
                                Alert.alert("Success", "Feedback rejected and removed");
                                fetchPendingFeedback();
                            } catch (error) {
                                console.error('Error deleting rejected feedback:', error);
                                Alert.alert("Error", "Failed to reject feedback");
                            }
                        }
                    }
                ]
            );
        } catch (error) {
            console.error('Error rejecting feedback:', error);
            Alert.alert("Error", "Failed to reject feedback");
        }
    };

    const onRefresh = React.useCallback(() => {
        setRefreshing(true);
        fetchPendingFeedback();
    }, []);

    const getFeatureLabel = (feature) => {
        const labels = {
            wheelchairRamps: 'Wheelchair Ramps',
            elevators: 'Elevators',
            chairs: 'Chairs',
            widePathways: 'Wide Pathways',
            pwdRestrooms: 'PWD Restrooms'
        };
        return labels[feature] || feature;
    };

    // Add this helper function to calculate distance between coordinates
    const calculateDistance = (coord1, coord2) => {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = (coord1.latitude * Math.PI) / 180;
        const φ2 = (coord2.latitude * Math.PI) / 180;
        const Δφ = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
        const Δλ = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        return distance;
    };

    const showLocalNotification = async (title, body) => {
        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: title,
                    body: body,
                    data: { data: 'goes here' },
                },
                trigger: null,
            });
        } catch (error) {
            console.error('Error showing notification:', error);
            Alert.alert('Notification Error', error.message);
        }
    };

    const handleImageLoad = (feedbackId) => {
        setImageLoading(prev => ({
            ...prev,
            [feedbackId]: false
        }));
    };

    const handleImageError = (feedbackId) => {
        setImageLoading(prev => ({
            ...prev,
            [feedbackId]: false
        }));
        Alert.alert('Error', 'Failed to load image');
    };

    const handleDeleteFeedback = async (feedbackId) => {
        try {
            Alert.alert(
                "Delete Feedback",
                "Are you sure you want to delete this feedback? This action cannot be undone.",
                [
                    {
                        text: "Cancel",
                        style: "cancel"
                    },
                    {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                            try {
                                await deleteDoc(doc(db, 'accessibility_feedback', feedbackId));
                                Alert.alert("Success", "Feedback deleted successfully");
                                fetchApprovedFeedback();
                            } catch (error) {
                                console.error('Error deleting feedback:', error);
                                Alert.alert("Error", "Failed to delete feedback");
                            }
                        }
                    }
                ]
            );
        } catch (error) {
            console.error('Error handling delete:', error);
            Alert.alert("Error", "Failed to process deletion");
        }
    };

    const SwipeableFeedbackItem = ({ feedback }) => {
        const pan = new Animated.ValueXY();
        const panResponder = PanResponder.create({
            onMoveShouldSetPanResponder: () => true,
            onPanResponderMove: (_, gesture) => {
                if (gesture.dx > 0) { // Only allow right swipe
                    pan.x.setValue(gesture.dx);
                }
            },
            onPanResponderRelease: (_, gesture) => {
                if (gesture.dx > 100) { // If swiped more than 100 units to the right
                    Animated.timing(pan, {
                        toValue: { x: 200, y: 0 },
                        duration: 200,
                        useNativeDriver: false
                    }).start(() => {
                        handleDeleteFeedback(feedback.id);
                    });
                } else {
                    Animated.spring(pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: false
                    }).start();
                }
            }
        });

        return (
            <Animated.View
                style={[
                    styles.feedbackCard,
                    {
                        transform: [{ translateX: pan.x }]
                    }
                ]}
                {...panResponder.panHandlers}
            >
                <View style={[styles.feedbackHeader, {
                    backgroundColor: 
                        feedback.type === 'accessible' ? '#4CAF50' :
                        feedback.type === 'partially' ? '#FFC107' : '#F44336'
                }]}>
                    <Text style={styles.feedbackType}>
                        {feedback.type.charAt(0).toUpperCase() + feedback.type.slice(1)}
                    </Text>
                </View>

                {feedback.panoramaImage && (
                    <View style={styles.imageContainer}>
                        <Image
                            source={{ uri: `data:image/jpeg;base64,${feedback.panoramaImage}` }}
                            style={styles.feedbackImage}
                            resizeMode="cover"
                        />
                    </View>
                )}

                <View style={styles.locationContainer}>
                    <Text style={styles.sectionTitle}>Location:</Text>
                    <Text style={styles.locationText}>
                        Lat: {feedback.coordinate.latitude.toFixed(6)}{'\n'}
                        Long: {feedback.coordinate.longitude.toFixed(6)}
                    </Text>
                </View>

                {feedback.features && feedback.features.length > 0 && (
                    <View style={styles.featuresContainer}>
                        <Text style={styles.sectionTitle}>Features:</Text>
                        <View style={styles.featuresList}>
                            {feedback.features.map((feature, index) => (
                                <View key={index} style={styles.featureItem}>
                                    <Ionicons
                                        name={
                                            feature === 'wheelchairRamps' ? 'accessibility-outline' :
                                            feature === 'elevators' ? 'arrow-up-outline' :
                                            feature === 'chairs' ? 'home-outline' :
                                            feature === 'pwdRestrooms' ? 'water-outline' :
                                            'resize-outline'
                                        }
                                        size={16}
                                        color="#40B59F"
                                    />
                                    <Text style={styles.featureText}>
                                        {getFeatureLabel(feature)}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {feedback.comment && (
                    <View style={styles.commentContainer}>
                        <Text style={styles.sectionTitle}>Comment:</Text>
                        <Text style={styles.commentText}>{feedback.comment}</Text>
                    </View>
                )}

                <View style={styles.deleteHint}>
                    <Ionicons name="trash-outline" size={20} color="#F44336" />
                    <Text style={styles.deleteHintText}>Swipe right to delete</Text>
                </View>
            </Animated.View>
        );
    };

    const panResponder = PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gesture) => {
            if ((activeTab === 'pending' && gesture.dx > 0) || 
                (activeTab === 'approved' && gesture.dx < 0)) {
                pan.x.setValue(gesture.dx);
            }
        },
        onPanResponderRelease: (_, gesture) => {
            if (Math.abs(gesture.dx) > screenWidth * 0.3) {
                // Swipe threshold reached
                if (gesture.dx > 0 && activeTab === 'pending') {
                    // Swipe right to show approved
                    Animated.timing(pan, {
                        toValue: { x: screenWidth, y: 0 },
                        duration: 300,
                        useNativeDriver: true
                    }).start(() => {
                        setActiveTab('approved');
                        pan.setValue({ x: 0, y: 0 });
                    });
                } else if (gesture.dx < 0 && activeTab === 'approved') {
                    // Swipe left to show pending
                    Animated.timing(pan, {
                        toValue: { x: -screenWidth, y: 0 },
                        duration: 300,
                        useNativeDriver: true
                    }).start(() => {
                        setActiveTab('pending');
                        pan.setValue({ x: 0, y: 0 });
                    });
                } else {
                    // Reset position
                    Animated.spring(pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: true
                    }).start();
                }
            } else {
                // Reset position if threshold not reached
                Animated.spring(pan, {
                    toValue: { x: 0, y: 0 },
                    useNativeDriver: true
                }).start();
            }
        }
    });

    const renderPendingFeedback = () => (
        <ScrollView
            style={styles.feedbackList}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
        >
            {pendingFeedback.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="checkmark-circle" size={50} color="#40B59F" />
                    <Text style={styles.emptyStateText}>No pending feedback</Text>
                </View>
            ) : (
                pendingFeedback.map((feedback) => (
                    <View key={feedback.id} style={styles.feedbackCard}>
                        <View style={[styles.feedbackHeader, {
                            backgroundColor: 
                                feedback.type === 'accessible' ? '#4CAF50' :
                                feedback.type === 'partially' ? '#FFC107' : '#F44336'
                        }]}>
                            <Text style={styles.feedbackType}>
                                {feedback.type.charAt(0).toUpperCase() + feedback.type.slice(1)}
                            </Text>
                        </View>

                        {feedback.panoramaImage && (
                            <View style={styles.imageContainer}>
                                <Image
                                    source={{ uri: `data:image/jpeg;base64,${feedback.panoramaImage}` }}
                                    style={styles.feedbackImage}
                                    resizeMode="cover"
                                />
                            </View>
                        )}

                        <View style={styles.locationContainer}>
                            <Text style={styles.sectionTitle}>Location:</Text>
                            <Text style={styles.locationText}>
                                Lat: {feedback.coordinate.latitude.toFixed(6)}{'\n'}
                                Long: {feedback.coordinate.longitude.toFixed(6)}
                            </Text>
                        </View>

                        {feedback.features && feedback.features.length > 0 && (
                            <View style={styles.featuresContainer}>
                                <Text style={styles.sectionTitle}>Features:</Text>
                                <View style={styles.featuresList}>
                                    {feedback.features.map((feature, index) => (
                                        <View key={index} style={styles.featureItem}>
                                            <Ionicons
                                                name={
                                                    feature === 'wheelchairRamps' ? 'accessibility-outline' :
                                                    feature === 'elevators' ? 'arrow-up-outline' :
                                                    feature === 'chairs' ? 'home-outline' :
                                                    feature === 'pwdRestrooms' ? 'water-outline' :
                                                    'resize-outline'
                                                }
                                                size={16}
                                                color="#40B59F"
                                            />
                                            <Text style={styles.featureText}>
                                                {getFeatureLabel(feature)}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        )}

                        {feedback.comment && (
                            <View style={styles.commentContainer}>
                                <Text style={styles.sectionTitle}>Comment:</Text>
                                <Text style={styles.commentText}>{feedback.comment}</Text>
                            </View>
                        )}

                        <View style={styles.userContainer}>
                            <Text style={styles.sectionTitle}>Submitted by:</Text>
                            <Text style={styles.userText}>{feedback.userEmail}</Text>
                        </View>

                        <View style={styles.actionButtons}>
                            <TouchableOpacity
                                style={[styles.actionButton, styles.approveButton]}
                                onPress={() => handleApproveFeedback(feedback.id)}
                            >
                                <Ionicons name="checkmark" size={20} color="white" />
                                <Text style={styles.actionButtonText}>Approve</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionButton, styles.rejectButton]}
                                onPress={() => handleRejectFeedback(feedback.id)}
                            >
                                <Ionicons name="close" size={20} color="white" />
                                <Text style={styles.actionButtonText}>Reject</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ))
            )}
        </ScrollView>
    );

    const renderApprovedFeedback = () => (
        <ScrollView
            style={styles.feedbackList}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
        >
            {approvedFeedback.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="checkmark-circle" size={50} color="#40B59F" />
                    <Text style={styles.emptyStateText}>No approved feedback</Text>
                </View>
            ) : (
                approvedFeedback.map((feedback) => (
                    <View key={feedback.id} style={styles.feedbackCard}>
                        <View style={[styles.feedbackHeader, {
                            backgroundColor: 
                                feedback.type === 'accessible' ? '#4CAF50' :
                                feedback.type === 'partially' ? '#FFC107' : '#F44336'
                        }]}>
                            <Text style={styles.feedbackType}>
                                {feedback.type.charAt(0).toUpperCase() + feedback.type.slice(1)}
                            </Text>
                        </View>

                        {feedback.panoramaImage && (
                            <View style={styles.imageContainer}>
                                <Image
                                    source={{ uri: `data:image/jpeg;base64,${feedback.panoramaImage}` }}
                                    style={styles.feedbackImage}
                                    resizeMode="cover"
                                />
                            </View>
                        )}

                        <View style={styles.locationContainer}>
                            <Text style={styles.sectionTitle}>Location:</Text>
                            <Text style={styles.locationText}>
                                Lat: {feedback.coordinate.latitude.toFixed(6)}{'\n'}
                                Long: {feedback.coordinate.longitude.toFixed(6)}
                            </Text>
                        </View>

                        {feedback.features && feedback.features.length > 0 && (
                            <View style={styles.featuresContainer}>
                                <Text style={styles.sectionTitle}>Features:</Text>
                                <View style={styles.featuresList}>
                                    {feedback.features.map((feature, index) => (
                                        <View key={index} style={styles.featureItem}>
                                            <Ionicons
                                                name={
                                                    feature === 'wheelchairRamps' ? 'accessibility-outline' :
                                                    feature === 'elevators' ? 'arrow-up-outline' :
                                                    feature === 'chairs' ? 'home-outline' :
                                                    feature === 'pwdRestrooms' ? 'water-outline' :
                                                    'resize-outline'
                                                }
                                                size={16}
                                                color="#40B59F"
                                            />
                                            <Text style={styles.featureText}>
                                                {getFeatureLabel(feature)}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        )}

                        {feedback.comment && (
                            <View style={styles.commentContainer}>
                                <Text style={styles.sectionTitle}>Comment:</Text>
                                <Text style={styles.commentText}>{feedback.comment}</Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={() => handleDeleteFeedback(feedback.id)}
                        >
                            <Ionicons name="trash-outline" size={20} color="white" />
                            <Text style={styles.deleteButtonText}>Delete</Text>
                        </TouchableOpacity>
                    </View>
                ))
            )}
        </ScrollView>
    );

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#40B59F" />
                <Text style={styles.loadingText}>Loading feedback...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Admin Panel</Text>
                <View style={styles.tabContainer}>
                    <TouchableOpacity
                        style={[styles.tab, activeTab === 'pending' && styles.activeTab]}
                        onPress={() => setActiveTab('pending')}
                    >
                        <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>
                            Pending ({pendingFeedback.length})
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tab, activeTab === 'approved' && styles.activeTab]}
                        onPress={() => setActiveTab('approved')}
                    >
                        <Text style={[styles.tabText, activeTab === 'approved' && styles.activeTabText]}>
                            Approved ({approvedFeedback.length})
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            <Animated.View
                style={[
                    styles.contentContainer,
                    {
                        transform: [{ translateX: pan.x }]
                    }
                ]}
                {...panResponder.panHandlers}
            >
                {activeTab === 'pending' ? renderPendingFeedback() : renderApprovedFeedback()}
            </Animated.View>

            <TouchableOpacity
                style={styles.testButton}
                onPress={() => showLocalNotification('Test', 'This is a test notification')}
            >
                <Text>Test Notification</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    header: {
        padding: 20,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#40B59F',
        marginTop: 40,
    },
    subtitle: {
        fontSize: 16,
        color: '#666',
        marginTop: 5,
    },
    feedbackList: {
        padding: 15,
    },
    feedbackCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 15,
        marginBottom: 15,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 3,
    },
    feedbackHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    feedbackType: {
        fontSize: 18,
        fontWeight: '600',
        color: '#40B59F',
    },
    timestamp: {
        fontSize: 14,
        color: '#666',
    },
    imageContainer: {
        marginBottom: 15,
    },
    feedbackImage: {
        width: '100%',
        height: 200,
        borderRadius: 8,
        marginTop: 8,
    },
    locationContainer: {
        marginBottom: 15,
    },
    locationText: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    featuresContainer: {
        marginBottom: 15,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    featuresList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f0f9f7',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 15,
        gap: 6,
    },
    featureText: {
        fontSize: 14,
        color: '#40B59F',
    },
    commentContainer: {
        marginBottom: 15,
    },
    commentText: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    userContainer: {
        marginBottom: 15,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#eee',
    },
    userText: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        gap: 6,
    },
    approveButton: {
        backgroundColor: '#4CAF50',
    },
    rejectButton: {
        backgroundColor: '#F44336',
    },
    actionButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#666',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyStateText: {
        fontSize: 16,
        color: '#666',
        marginTop: 10,
    },
    testButton: {
        backgroundColor: '#40B59F',
        padding: 16,
        borderRadius: 20,
        alignItems: 'center',
        marginTop: 20,
    },
    imageLoading: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginLeft: -20,
        marginTop: -20,
        zIndex: 1,
    },
    sectionHeader: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#40B59F',
        marginTop: 20,
        marginBottom: 10,
        paddingHorizontal: 15,
    },
    deleteHint: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
        gap: 8,
    },
    deleteHintText: {
        color: '#F44336',
        fontSize: 14,
    },
    tabContainer: {
        flexDirection: 'row',
        marginTop: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    tab: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
    },
    activeTab: {
        borderBottomWidth: 2,
        borderBottomColor: '#40B59F',
    },
    tabText: {
        fontSize: 16,
        color: '#666',
    },
    activeTabText: {
        color: '#40B59F',
        fontWeight: '600',
    },
    contentContainer: {
        flex: 1,
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F44336',
        padding: 10,
        borderRadius: 8,
        marginTop: 10,
        gap: 8,
    },
    deleteButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
    },
}); 
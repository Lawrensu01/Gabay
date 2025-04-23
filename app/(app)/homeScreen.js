import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Animated } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, orderBy, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useAuth } from '../../context/authContext';

export default function HomeScreen() {
    const [history, setHistory] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const navigation = useNavigation();
    const { user } = useAuth();

    useFocusEffect(
        React.useCallback(() => {
            if (user) {
                loadNavigationHistory();
            }
        }, [user])
    );

    const loadNavigationHistory = async () => {
        try {
            setLoading(true);
            const historyRef = collection(db, 'navigation_history');
            const q = query(
                historyRef,
                where('userId', '==', user.uid),
                orderBy('timestamp', 'desc')
            );

            const querySnapshot = await getDocs(q);
            const historyData = querySnapshot.docs.map(doc => ({
                ...doc.data(),
                firestoreId: doc.id // Save Firestore document ID for deletion
            }));

            setHistory(historyData);
        } catch (error) {
            console.error('Error loading navigation history:', error);
            Alert.alert('Error', 'Failed to load navigation history');
        } finally {
            setLoading(false);
        }
    };

    const handleHistoryItemPress = (item) => {
        // Navigate to Search tab with the selected destination
        navigation.navigate('Search', { 
            screen: 'Navigation',
            params: {
                selectedDestination: {
                    name: item.name,
                    placeId: item.placeId // If you stored this in history
                }
            }
        });
    };

    const handleDeleteHistory = async (firestoreId) => {
        Alert.alert(
            "Delete History",
            "Are you sure you want to delete this location from history?",
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
                            // Delete from Firestore
                            await deleteDoc(doc(db, 'navigation_history', firestoreId));
                            // Update local state
                            setHistory(prevHistory => 
                                prevHistory.filter(item => item.firestoreId !== firestoreId)
                            );
                            setSelectedId(null);
                        } catch (error) {
                            console.error('Error deleting history item:', error);
                            Alert.alert("Error", "Failed to delete history item");
                        }
                    }
                }
            ]
        );
    };

    const handleLongPress = (id) => {
        setSelectedId(id);
    };

    const renderHistoryItem = ({ item }) => {
        const isSelected = item.firestoreId === selectedId;

        return (
            <TouchableOpacity 
                style={styles.historyCard}
                onPress={() => {
                    if (isSelected) {
                        setSelectedId(null);
                    } else {
                        handleHistoryItemPress(item);
                    }
                }}
                onLongPress={() => handleLongPress(item.firestoreId)}
                delayLongPress={500}
            >
                <View style={[
                    styles.historyCardContent,
                    isSelected && styles.selectedCard
                ]}>
                    <View style={styles.locationIcon}>
                        <Ionicons 
                            name={isSelected ? "trash" : "navigate"} 
                            size={20} 
                            color={isSelected ? "#ff4444" : "#40B59F"} 
                        />
                    </View>
                    <View style={styles.historyTextContainer}>
                        <Text style={styles.historyName}>{item.name}</Text>
                        <Text style={styles.historyDate}>{item.date}</Text>
                    </View>
                    {isSelected && (
                        <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={() => handleDeleteHistory(item.firestoreId)}
                        >
                            <Text style={styles.deleteText}>Remove</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header Section */}
            <View style={styles.headerSection}>
                <Text style={styles.welcomeText}>Welcome to Gabay!</Text>
            </View>

            {/* Navigation History Section */}
            <View style={styles.historySection}>
                <View style={styles.historyHeader}>
                    <Ionicons name="location" size={24} color="#40B59F" />
                    <Text style={styles.historyTitle}>Navigation History</Text>
                </View>

                {history.length > 0 ? (
                    <FlatList 
                        data={history}
                        keyExtractor={(item) => item.firestoreId}
                        contentContainerStyle={styles.historyList}
                        renderItem={renderHistoryItem}
                        extraData={selectedId}
                    />
                ) : (
                    <View style={styles.emptyStateContainer}>
                        <Ionicons name="document" size={50} color="#ccc" />
                        <Text style={styles.emptyStateText}>
                            No navigation history yet
                        </Text>
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        padding: 20,
    },
    headerSection: {
        marginBottom: 30,
    },
    welcomeText: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#40B59F',
        marginBottom: 20,
        letterSpacing: 0.5,
    },
    historySection: {
        flex: 1,
    },
    historyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 15,
        paddingHorizontal: 5,
    },
    historyTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginLeft: 10,
        color: '#333',
    },
    historyList: {
        paddingBottom: 20,
    },
    historyCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
        elevation: 2,
    },
    historyCardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        borderRadius: 12,
    },
    selectedCard: {
        backgroundColor: '#fff5f5',
    },
    deleteButton: {
        backgroundColor: '#ff4444',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
        marginLeft: 10,
    },
    deleteText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
    },
    locationIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f0f9f7',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    historyTextContainer: {
        flex: 1,
    },
    historyName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    historyDate: {
        fontSize: 14,
        color: '#666',
    },
    emptyStateContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 50,
    },
    emptyStateText: {
        marginTop: 15,
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
    }
});
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect } from 'react';

export default function LoadingScreen() {
  const params = useLocalSearchParams();
  const photoUri = params.photoUri as string;

  useEffect(() => {
    if (photoUri) {
      uploadPhoto(photoUri);
    }
  }, [photoUri]);

  const uploadPhoto = async (photoUri: string) => {
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: photoUri,
        type: 'image/jpeg',
        name: 'receipt.jpg',
      } as any);

      const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
      const response = await fetch(`${apiBaseUrl}/api/v1/receipts/receipt-items/`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.ok) {
        const data = await response.json();

        // Navigate to receipt details page with the data
        router.replace({
          pathname: '/receipt-details',
          params: {
            data: JSON.stringify(data)
          }
        });
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      // Upload failed, navigate back to camera
      router.replace('/');
    }

    // Use mock data for now - simulate processing delay

    // Simulate processing time
    setTimeout(() => {
      // Navigate to receipt details page without data (will use mock data)
      router.replace('/receipt-details');
    }, 2000); // 2 second delay to show loading screen
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.title}>Processing Receipt</Text>
        <Text style={styles.subtitle}>Analyzing your receipt image...</Text>

        <View style={styles.progressContainer}>
          <View style={styles.progressSteps}>
            <Text style={styles.stepText}>📸 Photo captured</Text>
            <Text style={styles.stepText}>🔍 Extracting text...</Text>
            <Text style={styles.stepText}>📋 Processing items...</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 30,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
  },
  progressContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  progressSteps: {
    alignItems: 'flex-start',
  },
  stepText: {
    fontSize: 16,
    color: '#666',
    marginBottom: 12,
    paddingLeft: 10,
  },
});
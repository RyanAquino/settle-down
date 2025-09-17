import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import * as MediaLibrary from 'expo-media-library';

export default function LoadingScreen() {
  const params = useLocalSearchParams();
  const photoUri = params.photoUri as string;
  const fromLibrary = params.fromLibrary === 'true';
  const [isOffline, setIsOffline] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Processing Receipt');

  const savePhotoAsFallback = useCallback(async (photoUri: string) => {
    try {
      if (!fromLibrary) {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.saveToLibraryAsync(photoUri);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          router.replace({
            pathname: '/',
            params: {
              message: 'Upload failed. Photo saved to your photo library.',
            },
          });
          return;
        }
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.replace({
        pathname: '/',
        params: {
          error: 'Upload failed. Please try again.',
        },
      });
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.replace({
        pathname: '/',
        params: {
          error: 'Upload failed. Unable to save photo.',
        },
      });
    }
  }, [fromLibrary]);

  const uploadPhoto = useCallback(async (photoUri: string) => {
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: photoUri,
        type: 'image/jpeg',
        name: 'receipt.jpg',
      } as any);

      const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
      const authToken = process.env.EXPO_PUBLIC_AUTH_TOKEN;

      const headers: { [key: string]: string } = {
        'Content-Type': 'multipart/form-data',
      };

      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/v1/receipts/receipt-items/`, {
        method: 'POST',
        body: formData,
        headers,
      });

      if (response.ok) {
        const data = await response.json();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace({
          pathname: '/receipt-details',
          params: {
            data: JSON.stringify(data)
          }
        });
      } else {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch {
      await savePhotoAsFallback(photoUri);
    }
  }, [savePhotoAsFallback]);

  const handleLibraryPhotoOffline = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setTimeout(() => {
        router.replace({
          pathname: '/',
          params: {
            message: 'Internet connection required to process photos from your library.',
          },
        });
      }, 2000);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.replace({
        pathname: '/',
        params: {
          error: 'Unable to process photo.',
        },
      });
    }
  }, []);

  const saveCameraPhotoToLibrary = useCallback(async (photoUri: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Media library permission denied');
      }

      await MediaLibrary.saveToLibraryAsync(photoUri);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setTimeout(() => {
        router.replace({
          pathname: '/',
          params: {
            message: 'Photo saved to your photo library.',
          },
        });
      }, 2000);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.replace({
        pathname: '/',
        params: {
          error: 'Failed to save photo to library.',
        },
      });
    }
  }, []);

  const handleOfflinePhoto = useCallback(async (photoUri: string) => {
    if (fromLibrary) {
      await handleLibraryPhotoOffline();
    } else {
      await saveCameraPhotoToLibrary(photoUri);
    }
  }, [fromLibrary, handleLibraryPhotoOffline, saveCameraPhotoToLibrary]);

  const checkConnectivityAndProcess = useCallback(async (photoUri: string) => {
    try {
      const netInfoState = await NetInfo.fetch();
      const isConnected = netInfoState.isConnected === true;

      if (isConnected) {
        await uploadPhoto(photoUri);
      } else {
        setIsOffline(true);
        setStatusMessage('No Internet Connection');
        await handleOfflinePhoto(photoUri);
      }
    } catch {
      setIsOffline(true);
      setStatusMessage('Network Check Failed');
      await handleOfflinePhoto(photoUri);
    }
  }, [uploadPhoto, handleOfflinePhoto]);

  useEffect(() => {
    if (photoUri) {
      checkConnectivityAndProcess(photoUri);
    }
  }, [photoUri, checkConnectivityAndProcess]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={isOffline ? "#FF6B6B" : "#007AFF"} />
        <Text style={styles.title}>{statusMessage}</Text>
        <Text style={styles.subtitle}>
          {isOffline
            ? "Saving photo to device storage..."
            : "Analyzing your receipt image..."
          }
        </Text>

        <View style={styles.progressContainer}>
          <View style={styles.progressSteps}>
            <Text style={styles.stepText}>📸 Photo captured</Text>
            {isOffline ? (
              <>
                <Text style={styles.stepText}>💾 Saving offline...</Text>
                <Text style={styles.stepText}>🔄 Will sync when online</Text>
              </>
            ) : (
              <>
                <Text style={styles.stepText}>🔍 Extracting text...</Text>
                <Text style={styles.stepText}>📋 Processing items...</Text>
              </>
            )}
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
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

interface FirebaseOptions {
  projectId: string;
  privateKey: string;
  clientEmail: string;
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private app: admin.app.App | null = null;
  private isInitialized = false;

  constructor(@Inject('FIREBASE_OPTIONS') private options: FirebaseOptions) {}

  async onModuleInit() {
    // Skip if credentials are not properly configured
    if (!this.options.projectId || 
        !this.options.privateKey || 
        !this.options.clientEmail ||
        this.options.privateKey.includes('YOUR_KEY_HERE') ||
        this.options.projectId.includes('YOUR_')) {
      console.log('⚠️ Firebase Admin: Credentials not configured, skipping initialization');
      console.log('   To enable Firebase features, update FIREBASE_* in .env');
      return;
    }

    // Check if already initialized
    if (admin.apps.length > 0) {
      this.app = admin.apps[0]!;
      this.isInitialized = true;
      return;
    }

    try {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.options.projectId,
          privateKey: this.options.privateKey.replace(/\\n/g, '\n'),
          clientEmail: this.options.clientEmail,
        }),
      });
      this.isInitialized = true;
      console.log('✅ Firebase Admin initialized');
    } catch (error) {
      console.error('⚠️ Firebase Admin initialization failed:', error);
      console.log('   API will continue without Firebase features');
    }
  }

  private checkInitialized() {
    if (!this.isInitialized) {
      throw new Error('Firebase is not initialized. Please configure FIREBASE_* environment variables.');
    }
  }

  /**
   * Create a custom Firebase token for a Supabase user
   * This allows Supabase users to authenticate with Firebase/Firestore
   */
  async createCustomToken(uid: string, claims?: Record<string, any>): Promise<string | null> {
    if (!this.isInitialized) {
      console.warn('Firebase not initialized, cannot create custom token');
      return null;
    }
    try {
      const token = await admin.auth().createCustomToken(uid, claims);
      return token;
    } catch (error) {
      console.error('Error creating custom token:', error);
      throw error;
    }
  }

  /**
   * Verify a Firebase ID token
   */
  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken | null> {
    if (!this.isInitialized) return null;
    return admin.auth().verifyIdToken(idToken);
  }

  /**
   * Send push notification via FCM
   */
  async sendPushNotification(data: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    imageUrl?: string;
  }): Promise<string> {
    const message: admin.messaging.Message = {
      token: data.token,
      notification: {
        title: data.title,
        body: data.body,
        imageUrl: data.imageUrl,
      },
      data: data.data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: data.title,
              body: data.body,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    return admin.messaging().send(message);
  }

  /**
   * Send push notification to multiple devices
   */
  async sendMulticastNotification(data: {
    tokens: string[];
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<admin.messaging.BatchResponse> {
    const message: admin.messaging.MulticastMessage = {
      tokens: data.tokens,
      notification: {
        title: data.title,
        body: data.body,
      },
      data: data.data,
    };

    return admin.messaging().sendEachForMulticast(message);
  }

  /**
   * Send notification to a topic
   */
  async sendToTopic(data: {
    topic: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<string> {
    const message: admin.messaging.Message = {
      topic: data.topic,
      notification: {
        title: data.title,
        body: data.body,
      },
      data: data.data,
    };

    return admin.messaging().send(message);
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(tokens: string[], topic: string): Promise<admin.messaging.MessagingTopicManagementResponse> {
    return admin.messaging().subscribeToTopic(tokens, topic);
  }

  /**
   * Unsubscribe tokens from a topic
   */
  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<admin.messaging.MessagingTopicManagementResponse> {
    return admin.messaging().unsubscribeFromTopic(tokens, topic);
  }

  /**
   * Get Firestore instance
   */
  getFirestore(): admin.firestore.Firestore {
    return admin.firestore();
  }

  /**
   * Get Realtime Database instance
   */
  getDatabase(): admin.database.Database {
    return admin.database();
  }
}


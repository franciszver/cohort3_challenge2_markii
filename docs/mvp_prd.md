# PRD_MVP.md  
**Project:** Android Chat Application (React + Expo Go + AWS SDK)  
**Owner:** Engineering Team  
**Version:** v1.1  
**Last Updated:** YYYY-MM-DD  

---

## 1. Overview  
This document defines the requirements for an Android chat application built with **React**, **Expo Go**, and the **AWS SDK**. The app will be tested locally using Expo Go builds on an Android Virtual Device (AVD).  

The MVP will focus on **real-time one-on-one chat** with persistence, authentication, presence tracking, and a responsive UI that supports optimistic updates.  

---

## 2. Goals & Non-Goals  

### Goals  
- Enable **secure user authentication** with AWS Cognito.  
- Provide **one-on-one chat functionality** with **real-time message delivery**.  
- Ensure **message persistence** across app restarts.  
- Support **optimistic UI updates** for seamless user experience.  
- Display **online/offline presence indicators**.  
- Show **timestamps** for all messages.  
- Architect the app for **scalability** (future group chat, read receipts, push notifications).  

### Non-Goals (MVP)  
- Group chat (3+ users).  
- Media/file sharing.  
- Push notifications.  
- Advanced profile customization.  

---

## 3. User Stories  

- **Authentication**  
  - As a user, I can create an account and log in securely.  
  - As a user, I can view and edit my basic profile (username, avatar).  

- **Messaging**  
  - As a user, I can send a message to another user and see it appear instantly (optimistic UI).  
  - As a user, I can receive messages in real time without refreshing.  
  - As a user, I can see my chat history even after restarting the app.  
  - As a user, I can see when the other user is online or offline.  
  - As a user, I can see timestamps for each message.  

---

## 4. Functional Requirements  

### 4.1 Authentication  
- AWS Cognito for user registration, login, and session management.  
- JWT tokens stored securely (AsyncStorage).  
- Profile data stored in DynamoDB (username, avatar, status).  

### 4.2 Messaging  
- Real-time messaging via **AWS AppSync (GraphQL subscriptions)** or **AWS IoT PubSub**.  
- Messages stored in DynamoDB with schema:  

```json
{
  "messageId": "uuid",
  "senderId": "string",
  "receiverId": "string",
  "content": "string",
  "timestamp": "ISO8601",
  "status": "PENDING|SENT|DELIVERED"
}

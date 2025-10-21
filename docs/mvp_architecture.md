# Architecture_MVP.md
**Project:** Android Chat Application (React + Expo Go + AWS SDK)  
**Version:** v1.0  
**Last Updated:** YYYY-MM-DD  

---

## 1. Overview
This document describes the high-level architecture for the MVP chat application. It illustrates how **React Native + Expo Go**, **AWS Cognito**, **AppSync/DynamoDB**, and local caching interact to deliver real-time chat, persistence, and presence tracking.

---

## 2. Architecture Diagram

```mermaid
flowchart TD

    subgraph Client["📱 Client (Expo Go / React Native)"]
        UI["Chat UI (React Components)"]
        AuthModule["Auth Module (AWS Cognito SDK)"]
        MsgModule["Messaging Module (GraphQL Subscriptions)"]
        Cache["Local Cache (AsyncStorage/SQLite)"]
    end

    subgraph AWS["☁️ AWS Backend"]
        Cognito["Cognito (User Auth)"]
        AppSync["AppSync (GraphQL API + Subscriptions)"]
        DynamoDB["DynamoDB (Message + Presence Store)"]
        S3["S3 (Future: Avatars/Media)"]
    end

    UI --> AuthModule
    AuthModule --> Cognito

    UI --> MsgModule
    MsgModule <--> AppSync
    AppSync <--> DynamoDB

    MsgModule <--> Cache
    UI <--> Cache

    DynamoDB --> AppSync
    AppSync --> MsgModule

    %% Presence Tracking
    UI --> Presence["Presence Indicator"]
    Presence <--> AppSync
    AppSync <--> DynamoDB

    %% Optional future
    UI -.-> S3

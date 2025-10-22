/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const getUser = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      email
      emailLower
      username
      displayName
      avatar
      status
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const listUsers = /* GraphQL */ `
  query ListUsers(
    $filter: ModelUserFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listUsers(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        email
        emailLower
        username
        displayName
        avatar
        status
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getMessage = /* GraphQL */ `
  query GetMessage($id: ID!) {
    getMessage(id: $id) {
      id
      conversationId
      content
      attachments
      messageType
      senderId
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const listMessages = /* GraphQL */ `
  query ListMessages(
    $filter: ModelMessageFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listMessages(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        conversationId
        content
        attachments
        messageType
        senderId
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const getMessageRead = /* GraphQL */ `
  query GetMessageRead($id: ID!) {
    getMessageRead(id: $id) {
      id
      messageId
      userId
      deliveredAt
      readAt
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const listMessageReads = /* GraphQL */ `
  query ListMessageReads(
    $filter: ModelMessageReadFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listMessageReads(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        messageId
        userId
        deliveredAt
        readAt
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const lookupByEmail = /* GraphQL */ `
  query LookupByEmail(
    $emailLower: String!
    $createdAt: ModelStringKeyConditionInput
    $sortDirection: ModelSortDirection
    $filter: ModelUserFilterInput
    $limit: Int
    $nextToken: String
  ) {
    lookupByEmail(
      emailLower: $emailLower
      createdAt: $createdAt
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        email
        emailLower
        username
        displayName
        avatar
        status
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const lookupUserIdByUsername = /* GraphQL */ `
  query LookupUserIdByUsername(
    $username: String!
    $sortDirection: ModelSortDirection
    $filter: ModelUserFilterInput
    $limit: Int
    $nextToken: String
  ) {
    lookupUserIdByUsername(
      username: $username
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        email
        emailLower
        username
        displayName
        avatar
        status
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const messagesByConversationIdAndCreatedAt = /* GraphQL */ `
  query MessagesByConversationIdAndCreatedAt(
    $conversationId: String!
    $createdAt: ModelStringKeyConditionInput
    $sortDirection: ModelSortDirection
    $filter: ModelMessageFilterInput
    $limit: Int
    $nextToken: String
  ) {
    messagesByConversationIdAndCreatedAt(
      conversationId: $conversationId
      createdAt: $createdAt
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        conversationId
        content
        attachments
        messageType
        senderId
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const messageReadsByMessageIdAndUserId = /* GraphQL */ `
  query MessageReadsByMessageIdAndUserId(
    $messageId: String!
    $userId: ModelStringKeyConditionInput
    $sortDirection: ModelSortDirection
    $filter: ModelMessageReadFilterInput
    $limit: Int
    $nextToken: String
  ) {
    messageReadsByMessageIdAndUserId(
      messageId: $messageId
      userId: $userId
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        messageId
        userId
        deliveredAt
        readAt
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;
export const messageReadsByUserIdAndReadAt = /* GraphQL */ `
  query MessageReadsByUserIdAndReadAt(
    $userId: String!
    $readAt: ModelStringKeyConditionInput
    $sortDirection: ModelSortDirection
    $filter: ModelMessageReadFilterInput
    $limit: Int
    $nextToken: String
  ) {
    messageReadsByUserIdAndReadAt(
      userId: $userId
      readAt: $readAt
      sortDirection: $sortDirection
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        messageId
        userId
        deliveredAt
        readAt
        createdAt
        updatedAt
        __typename
      }
      nextToken
      __typename
    }
  }
`;

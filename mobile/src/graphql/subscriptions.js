/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const onMessageInConversation = /* GraphQL */ `
  subscription OnMessageInConversation($conversationId: String!) {
    onMessageInConversation(conversationId: $conversationId) {
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
export const onTypingInConversation = /* GraphQL */ `
  subscription OnTypingInConversation($conversationId: String!) {
    onTypingInConversation(conversationId: $conversationId) {
      conversationId
      userId
      at
      __typename
    }
  }
`;
export const onCreateUser = /* GraphQL */ `
  subscription OnCreateUser($filter: ModelSubscriptionUserFilterInput) {
    onCreateUser(filter: $filter) {
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
export const onUpdateUser = /* GraphQL */ `
  subscription OnUpdateUser($filter: ModelSubscriptionUserFilterInput) {
    onUpdateUser(filter: $filter) {
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
export const onDeleteUser = /* GraphQL */ `
  subscription OnDeleteUser($filter: ModelSubscriptionUserFilterInput) {
    onDeleteUser(filter: $filter) {
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
export const onCreateMessage = /* GraphQL */ `
  subscription OnCreateMessage($filter: ModelSubscriptionMessageFilterInput) {
    onCreateMessage(filter: $filter) {
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
export const onUpdateMessage = /* GraphQL */ `
  subscription OnUpdateMessage($filter: ModelSubscriptionMessageFilterInput) {
    onUpdateMessage(filter: $filter) {
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
export const onDeleteMessage = /* GraphQL */ `
  subscription OnDeleteMessage($filter: ModelSubscriptionMessageFilterInput) {
    onDeleteMessage(filter: $filter) {
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
export const onCreateMessageRead = /* GraphQL */ `
  subscription OnCreateMessageRead(
    $filter: ModelSubscriptionMessageReadFilterInput
  ) {
    onCreateMessageRead(filter: $filter) {
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
export const onUpdateMessageRead = /* GraphQL */ `
  subscription OnUpdateMessageRead(
    $filter: ModelSubscriptionMessageReadFilterInput
  ) {
    onUpdateMessageRead(filter: $filter) {
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
export const onDeleteMessageRead = /* GraphQL */ `
  subscription OnDeleteMessageRead(
    $filter: ModelSubscriptionMessageReadFilterInput
  ) {
    onDeleteMessageRead(filter: $filter) {
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

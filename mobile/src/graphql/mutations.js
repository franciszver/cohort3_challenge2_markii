/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const sendTyping = /* GraphQL */ `
  mutation SendTyping($conversationId: String!, $userId: String!) {
    sendTyping(conversationId: $conversationId, userId: $userId) {
      conversationId
      userId
      at
      __typename
    }
  }
`;
export const createUser = /* GraphQL */ `
  mutation CreateUser(
    $input: CreateUserInput!
    $condition: ModelUserConditionInput
  ) {
    createUser(input: $input, condition: $condition) {
      id
      email
      emailLower
      username
      displayName
      avatar
      status
      lastSeen
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const updateUser = /* GraphQL */ `
  mutation UpdateUser(
    $input: UpdateUserInput!
    $condition: ModelUserConditionInput
  ) {
    updateUser(input: $input, condition: $condition) {
      id
      email
      emailLower
      username
      displayName
      avatar
      status
      lastSeen
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const deleteUser = /* GraphQL */ `
  mutation DeleteUser(
    $input: DeleteUserInput!
    $condition: ModelUserConditionInput
  ) {
    deleteUser(input: $input, condition: $condition) {
      id
      email
      emailLower
      username
      displayName
      avatar
      status
      lastSeen
      createdAt
      updatedAt
      __typename
    }
  }
`;
export const createMessage = /* GraphQL */ `
  mutation CreateMessage(
    $input: CreateMessageInput!
    $condition: ModelMessageConditionInput
  ) {
    createMessage(input: $input, condition: $condition) {
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
export const updateMessage = /* GraphQL */ `
  mutation UpdateMessage(
    $input: UpdateMessageInput!
    $condition: ModelMessageConditionInput
  ) {
    updateMessage(input: $input, condition: $condition) {
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
export const deleteMessage = /* GraphQL */ `
  mutation DeleteMessage(
    $input: DeleteMessageInput!
    $condition: ModelMessageConditionInput
  ) {
    deleteMessage(input: $input, condition: $condition) {
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
export const createMessageRead = /* GraphQL */ `
  mutation CreateMessageRead(
    $input: CreateMessageReadInput!
    $condition: ModelMessageReadConditionInput
  ) {
    createMessageRead(input: $input, condition: $condition) {
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
export const updateMessageRead = /* GraphQL */ `
  mutation UpdateMessageRead(
    $input: UpdateMessageReadInput!
    $condition: ModelMessageReadConditionInput
  ) {
    updateMessageRead(input: $input, condition: $condition) {
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
export const deleteMessageRead = /* GraphQL */ `
  mutation DeleteMessageRead(
    $input: DeleteMessageReadInput!
    $condition: ModelMessageReadConditionInput
  ) {
    deleteMessageRead(input: $input, condition: $condition) {
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

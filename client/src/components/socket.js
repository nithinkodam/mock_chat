// src/socket.js
import { io } from "socket.io-client";

const SOCKET_URL = "https://mock-chat-backend.onrender.com";

let socket;

export const initSocket = (token) => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
    });
  }
  return socket;
};

export const getSocket = (token) => {
  if (!socket && token) {
    return initSocket(token);
  }
  return socket;
};

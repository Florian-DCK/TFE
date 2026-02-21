import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true,
    });
  }
  return socket;
}

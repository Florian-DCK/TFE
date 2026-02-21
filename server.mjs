import http from "node:http";
import next from "next";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { jwtVerify } from "jose";
import {
  applyAction,
  createGameFromLobby,
  ensureMapsSeeded,
  findLatestGameByLobbyCode,
  getDefaultMapKey,
  getGameStateDTO,
  getGameStateDTOWithOptions,
  listMapsMetadata,
} from "./app/lib/game/server.js";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);
const prisma = new PrismaClient();
const SERVER_REV = "start-game-debug-2";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();
await ensureMapsSeeded(prisma);

const server = http.createServer((req, res) => handle(req, res));

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: true,
    credentials: true,
  },
});

// lobbyCode -> Map(socketId -> { id, name, userId })
const lobbies = new Map();
const lobbyToGameCode = new Map();
const actionRateLimit = new Map();

const sessionSecret = process.env.SESSION_SECRET ?? process.env.SECRET;
const sessionKey = sessionSecret ? new TextEncoder().encode(sessionSecret) : null;

function getLobbyMap(lobbyCode) {
  if (!lobbies.has(lobbyCode)) lobbies.set(lobbyCode, new Map());
  return lobbies.get(lobbyCode);
}

function emitLobbyState(lobbyCode) {
  const lobby = getLobbyMap(lobbyCode);
  const hostSocketId = lobby.size > 0 ? Array.from(lobby.keys())[0] : null;
  const members = Array.from(lobby.entries()).map(([socketId, member]) => ({
    ...member,
    isHost: socketId === hostSocketId,
  }));
  io.to(lobbyCode).emit("lobby_state", {
    lobbyCode,
    members,
    hostSocketId,
    gameCode: lobbyToGameCode.get(lobbyCode) ?? null,
  });
}

function parseCookies(cookieHeader = "") {
  const out = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name) continue;
    out[name] = decodeURIComponent(valueParts.join("="));
  }
  return out;
}

async function getSocketUserId(socket) {
  if (!sessionKey) return null;
  const cookies = parseCookies(socket.handshake.headers.cookie ?? "");
  const token = cookies.session;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey, {
      algorithms: ["HS256"],
    });
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}

async function emitGameState(gameCode, { includeLogs = true } = {}) {
  const state = includeLogs
    ? await getGameStateDTO(prisma, gameCode)
    : await getGameStateDTOWithOptions(prisma, gameCode, { includeLogs: false });
  if (!state) return;
  io.to(`game:${gameCode}`).emit("game_state", state);
  if (state.status === "finished") {
    io.to(`game:${gameCode}`).emit("game_finished", {
      gameCode,
      winnerPlayerId: state.winnerPlayerId,
    });
  }
}

function isRateLimited(socketId) {
  const now = Date.now();
  const last = actionRateLimit.get(socketId) ?? 0;
  if (now - last < 250) return true;
  actionRateLimit.set(socketId, now);
  return false;
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id, SERVER_REV);
  socket.emit("server_info", { rev: SERVER_REV });
  socket.emit("maps_list", { maps: listMapsMetadata() });

  socket.on("request_maps_list", () => {
    socket.emit("maps_list", { maps: listMapsMetadata() });
  });

  socket.onAny((eventName) => {
    if (eventName === "submit_action") return;
    console.log(JSON.stringify({ event: "socket_event", name: eventName, socketId: socket.id }));
  });

  socket.on("join_lobby", async ({ lobbyCode, name }) => {
    if (!lobbyCode) return;
    socket.emit("maps_list", { maps: listMapsMetadata() });

    const existingGameCode = lobbyToGameCode.get(lobbyCode);
    const existing = existingGameCode
      ? await getGameStateDTO(prisma, existingGameCode)
      : await findLatestGameByLobbyCode(prisma, lobbyCode);

    if (existing?.status === "in_progress") {
      lobbyToGameCode.set(lobbyCode, existing.code);
      socket.emit("lobby_locked", { lobbyCode, gameCode: existing.code });
      return;
    }

    const userId = await getSocketUserId(socket);

    socket.data.lobbyCode = lobbyCode;
    socket.data.name = name || `Player-${socket.id.slice(-4)}`;
    socket.data.userId = userId;

    socket.join(lobbyCode);

    const lobby = getLobbyMap(lobbyCode);
    lobby.set(socket.id, {
      id: socket.id,
      name: socket.data.name,
      userId,
    });

    emitLobbyState(lobbyCode);
  });

  socket.on("start_game", async (payload = {}, ack) => {
    try {
      const lobbyCode = typeof payload?.lobbyCode === "string" ? payload.lobbyCode : undefined;
      const mapKey = typeof payload?.mapKey === "string" ? payload.mapKey : getDefaultMapKey();
      console.log(
        JSON.stringify({
          event: "start_game_received",
          socketId: socket.id,
          lobbyCode: lobbyCode ?? null,
          mapKey,
          socketLobbyCode: socket.data.lobbyCode ?? null,
          lobbySize: lobbyCode ? getLobbyMap(lobbyCode).size : null,
        }),
      );

      const code = lobbyCode || socket.data.lobbyCode;
      if (!code) {
        const reason = "Lobby code missing.";
        socket.emit("action_rejected", { reason });
        if (typeof ack === "function") ack({ ok: false, reason });
        return;
      }
      if (lobbyToGameCode.get(code)) {
        const reason = "Game already started.";
        socket.emit("action_rejected", { reason });
        if (typeof ack === "function") ack({ ok: false, reason });
        return;
      }

      const lobby = getLobbyMap(code);
      if (lobby.size < 2) {
        const reason = "At least 2 players required.";
        socket.emit("action_rejected", { reason });
        if (typeof ack === "function") ack({ ok: false, reason });
        return;
      }

      const lobbyMembers = Array.from(lobby.values()).slice(0, 2);
      const game = await createGameFromLobby(prisma, code, lobbyMembers, mapKey);
      lobbyToGameCode.set(code, game.code);

      console.log(
        JSON.stringify({
          event: "game_started",
          lobbyCode: code,
          gameCode: game.code,
          players: lobbyMembers.map((p) => p.name),
        }),
      );

      io.to(code).emit("game_started", {
        lobbyCode: code,
        gameCode: game.code,
        path: `/fr/game/${game.code}`,
      });
      if (typeof ack === "function") {
        ack({ ok: true, lobbyCode: code, gameCode: game.code });
      }
      emitLobbyState(code);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to start game.";
      socket.emit("action_rejected", {
        reason,
      });
      if (typeof ack === "function") ack({ ok: false, reason });
    }
  });

  socket.on("leave_lobby", ({ lobbyCode }) => {
    const code = lobbyCode || socket.data.lobbyCode;
    if (!code) return;

    socket.leave(code);

    const lobby = getLobbyMap(code);
    lobby.delete(socket.id);

    emitLobbyState(code);
  });

  socket.on("join_game", async ({ gameCode }) => {
    const state = await getGameStateDTO(prisma, gameCode);
    if (!state) {
      socket.emit("action_rejected", { reason: "Game not found." });
      return;
    }

    const userId = socket.data.userId;
    let player = null;
    if (userId) {
      player = await prisma.gamePlayer.findFirst({
        where: { game: { code: gameCode }, userId },
      });
    }
    if (!player && socket.data.name) {
      player = await prisma.gamePlayer.findFirst({
        where: { game: { code: gameCode }, displayName: socket.data.name },
      });
    }
    if (!player) {
      socket.emit("action_rejected", { reason: "You are not a participant of this game." });
      return;
    }

    socket.data.gameCode = gameCode;
    socket.data.gamePlayerId = player.id;
    socket.join(`game:${gameCode}`);
    socket.emit("joined_game", {
      gameCode,
      playerId: player.id,
      displayName: player.displayName,
    });

    await prisma.gamePlayer.update({
      where: { id: player.id },
      data: { isConnected: true },
    });

    await emitGameState(gameCode);
  });

  socket.on("leave_game", async ({ gameCode }) => {
    const code = gameCode || socket.data.gameCode;
    if (!code) return;

    socket.leave(`game:${code}`);

    if (socket.data.gamePlayerId) {
      await prisma.gamePlayer.update({
        where: { id: socket.data.gamePlayerId },
        data: { isConnected: false },
      });
      await emitGameState(code);
    }
  });

  socket.on("submit_action", async ({ gameCode, action }) => {
    const code = gameCode || socket.data.gameCode;
    const playerId = socket.data.gamePlayerId;

    try {
      if (!code || !playerId) {
        socket.emit("action_rejected", { reason: "Join a game first." });
        return;
      }
      if (isRateLimited(socket.id)) {
        socket.emit("action_rejected", { reason: "Too many actions. Slow down." });
        return;
      }

      const actionResult = await applyAction(prisma, code, playerId, action);

      console.log(
        JSON.stringify({
          event: "submit_action",
          gameCode: code,
          playerId,
          actionType: action?.type ?? "unknown",
          result: "ok",
        }),
      );

      if (actionResult?.log) {
        io.to(`game:${code}`).emit("action_log", actionResult.log);
      }
      if (actionResult?.patch) {
        io.to(`game:${code}`).emit("action_applied", actionResult.patch);
      }
      if (actionResult?.finished) {
        io.to(`game:${code}`).emit("game_finished", {
          gameCode: code,
          winnerPlayerId: actionResult.winnerPlayerId ?? null,
        });
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "submit_action",
          gameCode: code ?? null,
          playerId: playerId ?? null,
          actionType: action?.type ?? "unknown",
          result: "rejected",
          reason: error instanceof Error ? error.message : "Unknown error",
        }),
      );
      socket.emit("action_rejected", {
        reason: error instanceof Error ? error.message : "Action rejected.",
      });
    }
  });

  socket.on("action_intent", ({ gameCode, intent }) => {
    const code = gameCode || socket.data.gameCode;
    const playerId = socket.data.gamePlayerId;
    if (!code || !playerId || !intent || typeof intent !== "object") return;

    const fromTerritoryKey =
      typeof intent.fromTerritoryKey === "string" ? intent.fromTerritoryKey : null;
    const toTerritoryKey =
      typeof intent.toTerritoryKey === "string" ? intent.toTerritoryKey : null;
    const phase = typeof intent.phase === "string" ? intent.phase : null;
    const kind = intent.kind === "clear" ? "clear" : "select";

    socket.to(`game:${code}`).emit("opponent_intent", {
      gameCode: code,
      playerId,
      phase,
      kind,
      fromTerritoryKey,
      toTerritoryKey,
    });
  });

  socket.on("disconnect", async () => {
    const code = socket.data.lobbyCode;
    if (code) {
      const lobby = getLobbyMap(code);
      lobby.delete(socket.id);
      emitLobbyState(code);
    }

    const gameCode = socket.data.gameCode;
    if (gameCode && socket.data.gamePlayerId) {
      await prisma.gamePlayer.update({
        where: { id: socket.data.gamePlayerId },
        data: { isConnected: false },
      });
      await emitGameState(gameCode);
    }
  });
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}`);
});

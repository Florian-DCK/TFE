import { z } from "zod";
import { loadMapDefinition, listAvailableMaps } from "./maps/index.js";
import {
  canAttack,
  canFortify,
  checkVictory,
  computeReinforcements,
  resolveAttack,
} from "./rules.js";

export const submitActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("place_reinforcement"),
    territoryKey: z.string().min(1),
  }),
  z.object({
    type: z.literal("attack"),
    fromTerritoryKey: z.string().min(1),
    toTerritoryKey: z.string().min(1),
    attackDice: z.number().int().min(1).max(3),
  }),
  z.object({
    type: z.literal("fortify"),
    fromTerritoryKey: z.string().min(1),
    toTerritoryKey: z.string().min(1),
    troops: z.number().int().min(1),
  }),
  z.object({ type: z.literal("end_turn") }),
]);

function randomCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function toAdjacencyArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  return [];
}

function toActionLogDTO(log) {
  return {
    id: log.id,
    turn: log.turn,
    actorPlayerId: log.actorPlayerId,
    type: log.type,
    payload: log.payload,
    createdAt: log.createdAt.toISOString(),
  };
}

export function getDefaultMapKey() {
  return "world-simplified";
}

export function listMapsMetadata() {
  return listAvailableMaps().map((key) => {
    const def = loadMapDefinition(key);
    return {
      key: def.mapKey,
      name: def.name,
      version: def.version,
      territories: def.territories.length,
    };
  });
}

export async function ensureMapsSeeded(prisma) {
  const mapKeys = listAvailableMaps();

  for (const mapKey of mapKeys) {
    const definition = loadMapDefinition(mapKey);

    const map = await prisma.mapDefinition.upsert({
      where: { key: definition.mapKey },
      create: {
        key: definition.mapKey,
        name: definition.name,
        version: definition.version,
        svgViewBox: definition.viewBox,
        isActive: true,
      },
      update: {
        name: definition.name,
        version: definition.version,
        svgViewBox: definition.viewBox,
        isActive: true,
      },
    });

    const existing = await prisma.mapTerritory.findMany({
      where: { mapId: map.id },
      select: { key: true },
    });

    const incomingKeys = new Set(definition.territories.map((t) => t.key));
    const obsoleteKeys = existing.filter((e) => !incomingKeys.has(e.key)).map((e) => e.key);
    if (obsoleteKeys.length > 0) {
      await prisma.mapTerritory.deleteMany({
        where: {
          mapId: map.id,
          key: { in: obsoleteKeys },
        },
      });
    }

    for (const territory of definition.territories) {
      await prisma.mapTerritory.upsert({
        where: {
          mapId_key: {
            mapId: map.id,
            key: territory.key,
          },
        },
        create: {
          mapId: map.id,
          key: territory.key,
          name: territory.name,
          svgId: territory.svgId,
          pathData: territory.pathData,
          adjacency: territory.adjacency,
          continent: territory.continent ?? null,
          centroidX: territory.centroid.x,
          centroidY: territory.centroid.y,
        },
        update: {
          name: territory.name,
          svgId: territory.svgId,
          pathData: territory.pathData,
          adjacency: territory.adjacency,
          continent: territory.continent ?? null,
          centroidX: territory.centroid.x,
          centroidY: territory.centroid.y,
        },
      });
    }
  }
}

export async function findLatestGameByLobbyCode(prisma, lobbyCode) {
  return prisma.game.findFirst({
    where: { lobbyCode },
    orderBy: { createdAt: "desc" },
  });
}

export async function createGameFromLobby(prisma, lobbyCode, lobbyMembers, mapKey = getDefaultMapKey()) {
  if (!Array.isArray(lobbyMembers) || lobbyMembers.length < 2) {
    throw new Error("Two players are required to start a game.");
  }

  const playersInput = lobbyMembers.slice(0, 2);

  const map = await prisma.mapDefinition.findUnique({
    where: { key: mapKey },
    include: {
      territories: {
        orderBy: { key: "asc" },
      },
    },
  });
  if (!map || !map.isActive) {
    throw new Error(`Map \"${mapKey}\" is not available.`);
  }

  let code = randomCode(6);
  while (await prisma.game.findUnique({ where: { code } })) {
    code = randomCode(6);
  }

  const game = await prisma.$transaction(async (tx) => {
    const created = await tx.game.create({
      data: {
        code,
        lobbyCode,
        status: "in_progress",
        mapId: map.id,
      },
    });

    const createdPlayers = await tx.gamePlayer.createManyAndReturn({
      data: playersInput.map((p, index) => ({
        gameId: created.id,
        userId: p.userId ?? null,
        displayName: p.name,
        seat: index + 1,
        isAlive: true,
        isConnected: true,
        reinforcements: index === 0 ? computeReinforcements() : 0,
      })),
      select: { id: true, seat: true },
    });

    createdPlayers.sort((a, b) => a.seat - b.seat);

    await tx.game.update({
      where: { id: created.id },
      data: { currentTurnPlayerId: createdPlayers[0].id },
    });

    await tx.gameTerritoryState.createMany({
      data: map.territories.map((territory, index) => {
        const owner = createdPlayers[index % createdPlayers.length];
        return {
          gameId: created.id,
          mapTerritoryId: territory.id,
          ownerPlayerId: owner.id,
          troops: 1,
        };
      }),
    });

    await tx.gameActionLog.create({
      data: {
        gameId: created.id,
        turn: 1,
        actorPlayerId: null,
        type: "game_started",
        payload: { lobbyCode, mapKey, players: playersInput.map((p) => p.name) },
      },
    });

    return created;
  });

  return game;
}

export async function getGameStateDTO(prisma, gameCode) {
  return getGameStateDTOWithOptions(prisma, gameCode, { includeLogs: true, logsLimit: 20 });
}

export async function getGameStateDTOWithOptions(
  prisma,
  gameCode,
  { includeLogs = true, logsLimit = 20 } = {},
) {
  const game = await prisma.game.findUnique({
    where: { code: gameCode },
    include: {
      map: true,
      players: { orderBy: { seat: "asc" } },
      territories: {
        include: {
          mapTerritory: true,
          territory: true,
        },
      },
      ...(includeLogs
        ? { actionLogs: { orderBy: { createdAt: "asc" }, take: logsLimit } }
        : {}),
    },
  });
  if (!game || !game.map) return null;

  const territoryCounts = new Map();
  for (const t of game.territories) {
    territoryCounts.set(t.ownerPlayerId, (territoryCounts.get(t.ownerPlayerId) ?? 0) + 1);
  }

  return {
    gameCode: game.code,
    lobbyCode: game.lobbyCode,
    map: {
      key: game.map.key,
      name: game.map.name,
      viewBox: game.map.svgViewBox,
    },
    status: game.status,
    turnNumber: game.turnNumber,
    currentTurnPlayerId: game.currentTurnPlayerId,
    winnerPlayerId: game.winnerPlayerId,
    players: game.players.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      seat: p.seat,
      isAlive: p.isAlive,
      isConnected: p.isConnected,
      reinforcements: p.reinforcements,
      territoryCount: territoryCounts.get(p.id) ?? 0,
    })),
    territories: game.territories
      .map((t) => {
        const mt = t.mapTerritory;
        const lt = t.territory;
        const territoryKey = mt?.key ?? lt?.key;
        const territoryName = mt?.name ?? lt?.name;
        const svgId = mt?.svgId ?? lt?.svgId;
        if (!territoryKey || !territoryName || !svgId) return null;
        return {
          territoryKey,
          territoryName,
          svgId,
          continent: mt?.continent ?? lt?.continent ?? null,
          centroid: {
            x: mt?.centroidX ?? 0,
            y: mt?.centroidY ?? 0,
          },
          adjacency: toAdjacencyArray(mt?.adjacency ?? lt?.adjacency ?? []),
          pathData: mt?.pathData ?? "",
          ownerPlayerId: t.ownerPlayerId,
          troops: t.troops,
        };
      })
      .filter(Boolean),
    logs: includeLogs ? game.actionLogs.map(toActionLogDTO) : [],
  };
}

function nextPlayer(players, currentTurnPlayerId) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat).filter((p) => p.isAlive);
  const idx = sorted.findIndex((p) => p.id === currentTurnPlayerId);
  if (idx < 0) return sorted[0] ?? null;
  return sorted[(idx + 1) % sorted.length] ?? null;
}

export async function applyAction(prisma, gameCode, playerId, action) {
  const actionInput = submitActionSchema.parse(action);

  const result = await prisma.$transaction(async (tx) => {
    const game = await tx.game.findUnique({
      where: { code: gameCode },
      include: {
        players: { orderBy: { seat: "asc" } },
        territories: {
          include: {
            mapTerritory: true,
            territory: true,
          },
        },
      },
    });
    if (!game) throw new Error("Game not found.");
    if (game.status !== "in_progress") throw new Error("Game is not in progress.");

    const actingPlayer = game.players.find((p) => p.id === playerId);
    if (!actingPlayer) throw new Error("Player not found in this game.");
    if (game.currentTurnPlayerId !== playerId && actionInput.type !== "ready") {
      throw new Error("It is not your turn.");
    }

    const territoryByKey = new Map();
    const adjacencyByKey = new Map();
    for (const t of game.territories) {
      const mt = t.mapTerritory;
      const lt = t.territory;
      const territoryKey = mt?.key ?? lt?.key;
      if (!territoryKey) continue;
      territoryByKey.set(territoryKey, {
        id: t.id,
        mapTerritoryId: t.mapTerritoryId,
        territoryKey,
        ownerPlayerId: t.ownerPlayerId,
        troops: t.troops,
      });
      adjacencyByKey.set(territoryKey, new Set(toAdjacencyArray(mt?.adjacency ?? lt?.adjacency ?? [])));
    }

    const writeLog = async (type, payload) => {
      return tx.gameActionLog.create({
        data: {
          gameId: game.id,
          turn: game.turnNumber,
          actorPlayerId: actingPlayer.id,
          type,
          payload,
        },
      });
    };

    if (actionInput.type === "ready") {
      const log = await writeLog("ready", {});
      return { type: "ok", log: toActionLogDTO(log) };
    }

    if (actionInput.type === "place_reinforcement") {
      if (actingPlayer.reinforcements <= 0) throw new Error("No reinforcements left.");
      const target = territoryByKey.get(actionInput.territoryKey);
      if (!target || target.ownerPlayerId !== actingPlayer.id) {
        throw new Error("You can only reinforce your territory.");
      }
      await tx.gameTerritoryState.update({
        where: { id: target.id },
        data: { troops: { increment: 1 } },
      });
      await tx.gamePlayer.update({
        where: { id: actingPlayer.id },
        data: { reinforcements: { decrement: 1 } },
      });
      const log = await writeLog("place_reinforcement", {
        territoryKey: actionInput.territoryKey,
        troops: 1,
      });
      return { type: "ok", log: toActionLogDTO(log) };
    }

    if (actionInput.type === "attack") {
      const from = territoryByKey.get(actionInput.fromTerritoryKey);
      const to = territoryByKey.get(actionInput.toTerritoryKey);
      const adjacencySet = adjacencyByKey.get(actionInput.fromTerritoryKey) ?? new Set();
      if (!canAttack(from, to, actingPlayer.id, adjacencySet)) {
        throw new Error("Invalid attack.");
      }

      const roll = resolveAttack(from.troops, to.troops, actionInput.attackDice);

      const fromAfter = from.troops - roll.attackerLosses;
      const toAfter = to.troops - roll.defenderLosses;

      await tx.gameTerritoryState.update({
        where: { id: from.id },
        data: { troops: fromAfter },
      });

      if (toAfter <= 0) {
        await tx.gameTerritoryState.update({
          where: { id: to.id },
          data: {
            ownerPlayerId: actingPlayer.id,
            troops: 1,
          },
        });
        await tx.gameTerritoryState.update({
          where: { id: from.id },
          data: { troops: fromAfter - 1 },
        });
      } else {
        await tx.gameTerritoryState.update({
          where: { id: to.id },
          data: { troops: toAfter },
        });
      }

      const log = await writeLog("attack", {
        fromTerritoryKey: actionInput.fromTerritoryKey,
        toTerritoryKey: actionInput.toTerritoryKey,
        attackDice: actionInput.attackDice,
        ...roll,
      });

      const refreshed = await tx.gameTerritoryState.findMany({ where: { gameId: game.id } });
      const winnerPlayerId = checkVictory(game.players, refreshed);
      if (winnerPlayerId) {
        await tx.game.update({
          where: { id: game.id },
          data: { status: "finished", winnerPlayerId },
        });
      }

      return {
        type: "ok",
        finished: Boolean(winnerPlayerId),
        winnerPlayerId,
        log: toActionLogDTO(log),
      };
    }

    if (actionInput.type === "fortify") {
      const from = territoryByKey.get(actionInput.fromTerritoryKey);
      const to = territoryByKey.get(actionInput.toTerritoryKey);
      const adjacencySet = adjacencyByKey.get(actionInput.fromTerritoryKey) ?? new Set();
      if (!canFortify(from, to, actingPlayer.id, adjacencySet, actionInput.troops)) {
        throw new Error("Invalid fortify move.");
      }
      await tx.gameTerritoryState.update({
        where: { id: from.id },
        data: { troops: { decrement: actionInput.troops } },
      });
      await tx.gameTerritoryState.update({
        where: { id: to.id },
        data: { troops: { increment: actionInput.troops } },
      });
      const log = await writeLog("fortify", actionInput);
      return { type: "ok", log: toActionLogDTO(log) };
    }

    if (actionInput.type === "end_turn") {
      const upcoming = nextPlayer(game.players, game.currentTurnPlayerId);
      if (!upcoming) throw new Error("No available player for next turn.");
      await tx.game.update({
        where: { id: game.id },
        data: {
          currentTurnPlayerId: upcoming.id,
          turnNumber: { increment: 1 },
        },
      });
      await tx.gamePlayer.update({
        where: { id: upcoming.id },
        data: { reinforcements: computeReinforcements() },
      });
      const log = await writeLog("end_turn", { nextPlayerId: upcoming.id });
      return { type: "ok", nextPlayerId: upcoming.id, log: toActionLogDTO(log) };
    }

    throw new Error("Unsupported action.");
  });

  return result;
}

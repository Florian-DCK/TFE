import { z } from "zod";
import { loadMapDefinition, listAvailableMaps } from "./maps/index.js";
import {
  canAttack,
  checkVictory,
  computeReinforcements,
  resolveAttack,
} from "./rules.js";

export const submitActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("place_reinforcement"),
    territoryKey: z.string().min(1),
    troops: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal("attack"),
    fromTerritoryKey: z.string().min(1),
    toTerritoryKey: z.string().min(1),
    attackDice: z.number().int().min(1).max(3),
    moveTroopsOnCapture: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal("fortify"),
    fromTerritoryKey: z.string().min(1),
    toTerritoryKey: z.string().min(1),
    troops: z.number().int().min(1),
  }),
  z.object({ type: z.literal("end_attack_phase") }),
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

function buildTerritoryCountMap(territories) {
  const counts = new Map();
  for (const territory of territories) {
    counts.set(territory.ownerPlayerId, (counts.get(territory.ownerPlayerId) ?? 0) + 1);
  }
  return counts;
}

function resolveCurrentPhase(game, actionLogs, currentTurnPlayerId) {
  const currentPlayer = game.players.find((p) => p.id === currentTurnPlayerId);
  if (!currentPlayer) return "reinforce";
  if (currentPlayer.reinforcements > 0) return "reinforce";

  const currentTurnLogs = actionLogs.filter(
    (log) => log.turn === game.turnNumber && log.actorPlayerId === currentTurnPlayerId,
  );
  const attackPhaseEnded = currentTurnLogs.some((log) => log.type === "end_attack_phase");
  return attackPhaseEnded ? "fortify" : "attack";
}

function hasAlliedPath(from, to, currentPlayerId, territoryByKey, adjacencyByKey) {
  if (!from || !to) return false;
  if (from.ownerPlayerId !== currentPlayerId || to.ownerPlayerId !== currentPlayerId) return false;
  if (from.territoryKey === to.territoryKey) return true;

  const visited = new Set([from.territoryKey]);
  const queue = [from.territoryKey];

  while (queue.length > 0) {
    const key = queue.shift();
    const neighbors = adjacencyByKey.get(key) ?? new Set();
    for (const neighborKey of neighbors) {
      if (visited.has(neighborKey)) continue;
      const neighbor = territoryByKey.get(neighborKey);
      if (!neighbor || neighbor.ownerPlayerId !== currentPlayerId) continue;
      if (neighborKey === to.territoryKey) return true;
      visited.add(neighborKey);
      queue.push(neighborKey);
    }
  }
  return false;
}

function toContinentBonusMap(mapDefinition) {
  const bonusMap = new Map();
  for (const continent of mapDefinition?.continents ?? []) {
    bonusMap.set(continent.key, continent.bonus);
  }
  return bonusMap;
}

function computeContinentBonusForPlayer(playerId, territoriesWithContinent, continentBonusMap) {
  if (!playerId) return 0;

  const ownerByContinent = new Map();
  for (const territory of territoriesWithContinent) {
    if (!territory.continent) continue;
    const list = ownerByContinent.get(territory.continent) ?? [];
    list.push(territory.ownerPlayerId);
    ownerByContinent.set(territory.continent, list);
  }

  let bonus = 0;
  for (const [continentKey, owners] of ownerByContinent.entries()) {
    if (owners.length === 0) continue;
    if (owners.every((ownerId) => ownerId === playerId)) {
      bonus += continentBonusMap.get(continentKey) ?? 0;
    }
  }
  return bonus;
}

function computeReinforcementsForPlayer(playerId, territoriesWithContinent, continentBonusMap) {
  const ownedTerritories = territoriesWithContinent.filter((territory) => territory.ownerPlayerId === playerId).length;
  const continentBonus = computeContinentBonusForPlayer(playerId, territoriesWithContinent, continentBonusMap);
  return computeReinforcements(ownedTerritories, continentBonus);
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
  const mapDefinition = loadMapDefinition(map.key);
  const continentBonusMap = toContinentBonusMap(mapDefinition);

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
        reinforcements: 0,
      })),
      select: { id: true, seat: true },
    });

    createdPlayers.sort((a, b) => a.seat - b.seat);

    await tx.game.update({
      where: { id: created.id },
      data: { currentTurnPlayerId: createdPlayers[0].id },
    });

    const initialTerritories = map.territories.map((territory, index) => {
        const owner = createdPlayers[index % createdPlayers.length];
        return {
          gameId: created.id,
          mapTerritoryId: territory.id,
          continent: territory.continent,
          ownerPlayerId: owner.id,
          troops: 1,
        };
      });

    await tx.gameTerritoryState.createMany({
      data: initialTerritories.map((territory) => ({
        gameId: territory.gameId,
        mapTerritoryId: territory.mapTerritoryId,
        ownerPlayerId: territory.ownerPlayerId,
        troops: territory.troops,
      })),
    });

    const firstPlayerId = createdPlayers[0].id;
    const firstPlayerReinforcements = computeReinforcementsForPlayer(
      firstPlayerId,
      initialTerritories.map((territory) => ({
        ownerPlayerId: territory.ownerPlayerId,
        continent: territory.continent,
      })),
      continentBonusMap,
    );

    await tx.gamePlayer.update({
      where: { id: firstPlayerId },
      data: { reinforcements: firstPlayerReinforcements },
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
      actionLogs: { orderBy: { createdAt: "asc" }, take: Math.max(logsLimit, 200) },
    },
  });
  if (!game || !game.map) return null;
  const mapDefinition = loadMapDefinition(game.map.key);
  const currentPhase = resolveCurrentPhase(game, game.actionLogs, game.currentTurnPlayerId);

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
      backgroundPng: mapDefinition.backgroundPng ?? null,
      continents: (mapDefinition.continents ?? []).map((continent) => ({
        key: continent.key,
        name: continent.name,
        bonus: continent.bonus,
        color: continent.color ?? null,
      })),
    },
    status: game.status,
    turnNumber: game.turnNumber,
    currentPhase,
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
    logs: includeLogs ? game.actionLogs.slice(-logsLimit).map(toActionLogDTO) : [],
  };
}

function nextPlayer(players, currentTurnPlayerId) {
  const sorted = [...players].sort((a, b) => a.seat - b.seat).filter((p) => p.isAlive);
  const idx = sorted.findIndex((p) => p.id === currentTurnPlayerId);
  if (idx < 0) return sorted[0] ?? null;
  return sorted[(idx + 1) % sorted.length] ?? null;
}

function computeNextRoundNumber(players, currentTurnPlayerId, upcomingPlayerId, currentTurnNumber) {
  const alive = [...players].sort((a, b) => a.seat - b.seat).filter((p) => p.isAlive);
  const currentIdx = alive.findIndex((p) => p.id === currentTurnPlayerId);
  const upcomingIdx = alive.findIndex((p) => p.id === upcomingPlayerId);
  if (currentIdx < 0 || upcomingIdx < 0) return currentTurnNumber;
  const wrapped = upcomingIdx <= currentIdx;
  return currentTurnNumber + (wrapped ? 1 : 0);
}

export async function applyAction(prisma, gameCode, playerId, action) {
  const actionInput = submitActionSchema.parse(action);

  const result = await prisma.$transaction(async (tx) => {
    const game = await tx.game.findUnique({
      where: { code: gameCode },
      include: {
        map: true,
        players: { orderBy: { seat: "asc" } },
        actionLogs: { orderBy: { createdAt: "asc" }, take: 300 },
        territories: {
          include: {
            mapTerritory: true,
            territory: true,
          },
        },
      },
    });
    if (!game) throw new Error("Game not found.");
    if (!game.map) throw new Error("Map not found.");
    if (game.status !== "in_progress") throw new Error("Game is not in progress.");
    const mapDefinition = loadMapDefinition(game.map.key);
    const continentBonusMap = toContinentBonusMap(mapDefinition);

    const actingPlayer = game.players.find((p) => p.id === playerId);
    if (!actingPlayer) throw new Error("Player not found in this game.");
    if (game.currentTurnPlayerId !== playerId && actionInput.type !== "ready") {
      throw new Error("It is not your turn.");
    }
    const currentPhase = resolveCurrentPhase(game, game.actionLogs, game.currentTurnPlayerId);

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
    const territoryCountsBefore = buildTerritoryCountMap(game.territories);

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
      return {
        type: "ok",
        log: toActionLogDTO(log),
        patch: { gameCode },
      };
    }

    if (actionInput.type === "place_reinforcement") {
      if (currentPhase !== "reinforce") throw new Error("Not reinforcement phase.");
      if (actingPlayer.reinforcements <= 0) throw new Error("No reinforcements left.");
      const target = territoryByKey.get(actionInput.territoryKey);
      if (!target || target.ownerPlayerId !== actingPlayer.id) {
        throw new Error("You can only reinforce your territory.");
      }
      const troopsToPlace = Math.min(
        Math.max(1, actionInput.troops ?? 1),
        actingPlayer.reinforcements,
      );
      await tx.gameTerritoryState.update({
        where: { id: target.id },
        data: { troops: { increment: troopsToPlace } },
      });
      await tx.gamePlayer.update({
        where: { id: actingPlayer.id },
        data: { reinforcements: { decrement: troopsToPlace } },
      });
      const log = await writeLog("place_reinforcement", {
        territoryKey: actionInput.territoryKey,
        troops: troopsToPlace,
      });
      return {
        type: "ok",
        log: toActionLogDTO(log),
        patch: {
          gameCode,
          currentPhase: actingPlayer.reinforcements - troopsToPlace > 0 ? "reinforce" : "attack",
          players: [{ id: actingPlayer.id, reinforcements: actingPlayer.reinforcements - troopsToPlace }],
          territories: [{ territoryKey: actionInput.territoryKey, troops: target.troops + troopsToPlace }],
        },
      };
    }

    if (actionInput.type === "attack") {
      if (currentPhase !== "attack") throw new Error("Not attack phase.");
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
        const maxMove = Math.max(1, fromAfter - 1);
        const requestedMove = actionInput.moveTroopsOnCapture ?? 1;
        const movedTroops = Math.min(Math.max(1, requestedMove), maxMove);
        await tx.gameTerritoryState.update({
          where: { id: to.id },
          data: {
            ownerPlayerId: actingPlayer.id,
            troops: movedTroops,
          },
        });
        await tx.gameTerritoryState.update({
          where: { id: from.id },
          data: { troops: fromAfter - movedTroops },
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
        moveTroopsOnCapture: actionInput.moveTroopsOnCapture ?? 1,
        ...roll,
      });

      const fromPatch = {
        territoryKey: actionInput.fromTerritoryKey,
        troops:
          toAfter <= 0
            ? fromAfter - Math.min(Math.max(1, actionInput.moveTroopsOnCapture ?? 1), Math.max(1, fromAfter - 1))
            : fromAfter,
      };
      const toPatch =
        toAfter <= 0
          ? {
              territoryKey: actionInput.toTerritoryKey,
              ownerPlayerId: actingPlayer.id,
              troops: Math.min(Math.max(1, actionInput.moveTroopsOnCapture ?? 1), Math.max(1, fromAfter - 1)),
            }
          : {
              territoryKey: actionInput.toTerritoryKey,
              troops: toAfter,
            };

      const playersPatch = [];
      if (toAfter <= 0) {
        const defenderTerritories = (territoryCountsBefore.get(to.ownerPlayerId) ?? 0) - 1;
        const attackerTerritories = (territoryCountsBefore.get(actingPlayer.id) ?? 0) + 1;
        playersPatch.push({
          id: actingPlayer.id,
          territoryCount: attackerTerritories,
        });
        playersPatch.push({
          id: to.ownerPlayerId,
          territoryCount: defenderTerritories,
          isAlive: defenderTerritories > 0,
        });
      }

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
        patch: {
          gameCode,
          currentPhase: winnerPlayerId ? undefined : "attack",
          status: winnerPlayerId ? "finished" : undefined,
          winnerPlayerId: winnerPlayerId ?? undefined,
          players: playersPatch.length > 0 ? playersPatch : undefined,
          territories: [fromPatch, toPatch],
        },
      };
    }

    if (actionInput.type === "fortify") {
      if (currentPhase !== "fortify") throw new Error("Not fortify phase.");
      if (
        game.actionLogs.some(
          (log) => log.turn === game.turnNumber && log.actorPlayerId === actingPlayer.id && log.type === "fortify",
        )
      ) {
        throw new Error("Fortify is allowed only once per turn.");
      }
      const from = territoryByKey.get(actionInput.fromTerritoryKey);
      const to = territoryByKey.get(actionInput.toTerritoryKey);
      if (!from || !to) throw new Error("Invalid fortify move.");
      if (actionInput.troops < 1) throw new Error("Invalid fortify move.");
      if (from.ownerPlayerId !== actingPlayer.id || to.ownerPlayerId !== actingPlayer.id) {
        throw new Error("Invalid fortify move.");
      }
      if (from.troops <= actionInput.troops) throw new Error("Invalid fortify move.");
      if (!hasAlliedPath(from, to, actingPlayer.id, territoryByKey, adjacencyByKey)) {
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
      const upcoming = nextPlayer(game.players, game.currentTurnPlayerId);
      if (!upcoming) throw new Error("No available player for next turn.");
      const nextTurnNumber = computeNextRoundNumber(
        game.players,
        game.currentTurnPlayerId,
        upcoming.id,
        game.turnNumber,
      );
      await tx.game.update({
        where: { id: game.id },
        data: {
          currentTurnPlayerId: upcoming.id,
          turnNumber: nextTurnNumber,
        },
      });
      const territoriesAfterFortify = await tx.gameTerritoryState.findMany({
        where: { gameId: game.id },
        include: { mapTerritory: true, territory: true },
      });
      const upcomingReinforcements = computeReinforcementsForPlayer(
        upcoming.id,
        territoriesAfterFortify.map((territory) => ({
          ownerPlayerId: territory.ownerPlayerId,
          continent: territory.mapTerritory?.continent ?? territory.territory?.continent ?? null,
        })),
        continentBonusMap,
      );
      await tx.gamePlayer.update({
        where: { id: upcoming.id },
        data: { reinforcements: upcomingReinforcements },
      });
      await tx.gameActionLog.create({
        data: {
          gameId: game.id,
          turn: game.turnNumber,
          actorPlayerId: actingPlayer.id,
          type: "end_turn",
          payload: { nextPlayerId: upcoming.id, autoAfterFortify: true },
        },
      });
      return {
        type: "ok",
        log: toActionLogDTO(log),
        patch: {
          gameCode,
          turnNumber: nextTurnNumber,
          currentTurnPlayerId: upcoming.id,
          currentPhase: "reinforce",
          players: [
            {
              id: upcoming.id,
              reinforcements: upcomingReinforcements,
            },
          ],
          territories: [
            { territoryKey: actionInput.fromTerritoryKey, troops: from.troops - actionInput.troops },
            { territoryKey: actionInput.toTerritoryKey, troops: to.troops + actionInput.troops },
          ],
        },
      };
    }

    if (actionInput.type === "end_attack_phase") {
      if (currentPhase !== "attack") throw new Error("Not attack phase.");
      if (
        game.actionLogs.some(
          (log) =>
            log.turn === game.turnNumber && log.actorPlayerId === actingPlayer.id && log.type === "end_attack_phase",
        )
      ) {
        throw new Error("Attack phase already ended.");
      }
      const log = await writeLog("end_attack_phase", {});
      return {
        type: "ok",
        log: toActionLogDTO(log),
        patch: {
          gameCode,
          currentPhase: "fortify",
        },
      };
    }

    if (actionInput.type === "end_turn") {
      if (currentPhase !== "fortify") throw new Error("End turn is only allowed in fortify phase.");
      const upcoming = nextPlayer(game.players, game.currentTurnPlayerId);
      if (!upcoming) throw new Error("No available player for next turn.");
      const nextTurnNumber = computeNextRoundNumber(
        game.players,
        game.currentTurnPlayerId,
        upcoming.id,
        game.turnNumber,
      );
      await tx.game.update({
        where: { id: game.id },
        data: {
          currentTurnPlayerId: upcoming.id,
          turnNumber: nextTurnNumber,
        },
      });
      const territoriesBeforeNextTurn = await tx.gameTerritoryState.findMany({
        where: { gameId: game.id },
        include: { mapTerritory: true, territory: true },
      });
      const upcomingReinforcements = computeReinforcementsForPlayer(
        upcoming.id,
        territoriesBeforeNextTurn.map((territory) => ({
          ownerPlayerId: territory.ownerPlayerId,
          continent: territory.mapTerritory?.continent ?? territory.territory?.continent ?? null,
        })),
        continentBonusMap,
      );
      await tx.gamePlayer.update({
        where: { id: upcoming.id },
        data: { reinforcements: upcomingReinforcements },
      });
      const log = await writeLog("end_turn", { nextPlayerId: upcoming.id });
      return {
        type: "ok",
        nextPlayerId: upcoming.id,
        log: toActionLogDTO(log),
        patch: {
          gameCode,
          turnNumber: nextTurnNumber,
          currentTurnPlayerId: upcoming.id,
          currentPhase: "reinforce",
          players: [{ id: upcoming.id, reinforcements: upcomingReinforcements }],
        },
      };
    }

    throw new Error("Unsupported action.");
  });

  return result;
}

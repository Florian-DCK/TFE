import { z } from "zod";

export type PlayerDTO = {
  id: string;
  displayName: string;
  seat: number;
  isAlive: boolean;
  isConnected: boolean;
  reinforcements: number;
  territoryCount: number;
};

export type TerritoryStateDTO = {
  territoryKey: string;
  territoryName: string;
  svgId: string;
  continent: string | null;
  centroid: { x: number; y: number };
  adjacency: string[];
  pathData: string;
  ownerPlayerId: string;
  troops: number;
};

export type ActionLogDTO = {
  id: string;
  turn: number;
  actorPlayerId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type TurnPhase = "reinforce" | "attack" | "fortify";

export type PlayerPatchDTO = {
  id: string;
  isAlive?: boolean;
  isConnected?: boolean;
  reinforcements?: number;
  territoryCount?: number;
};

export type TerritoryPatchDTO = {
  territoryKey: string;
  ownerPlayerId?: string;
  troops?: number;
};

export type GameStatePatchDTO = {
  gameCode: string;
  status?: "waiting" | "in_progress" | "finished";
  turnNumber?: number;
  currentPhase?: TurnPhase;
  currentTurnPlayerId?: string | null;
  winnerPlayerId?: string | null;
  players?: PlayerPatchDTO[];
  territories?: TerritoryPatchDTO[];
};

export type GameStateDTO = {
  gameCode: string;
  lobbyCode: string;
  map: {
    key: string;
    name: string;
    viewBox: string;
    backgroundPng?: string | null;
    continents: Array<{
      key: string;
      name: string;
      bonus: number;
      color: string | null;
    }>;
  };
  status: "waiting" | "in_progress" | "finished";
  turnNumber: number;
  currentPhase: TurnPhase;
  currentTurnPlayerId: string | null;
  winnerPlayerId: string | null;
  players: PlayerDTO[];
  territories: TerritoryStateDTO[];
  logs: ActionLogDTO[];
};

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

export type ClientAction = z.infer<typeof submitActionSchema>;

export type ServerEventPayloads = {
  game_state: GameStateDTO;
  action_applied: GameStatePatchDTO;
  action_rejected: { reason: string };
  game_started: { lobbyCode: string; gameCode: string; path: string };
  game_finished: { gameCode: string; winnerPlayerId: string | null };
  joined_game: { gameCode: string; playerId: string; displayName: string };
  action_log: ActionLogDTO;
  opponent_intent: {
    gameCode: string;
    playerId: string;
    phase: string | null;
    kind: "select" | "clear";
    fromTerritoryKey: string | null;
    toTerritoryKey: string | null;
  };
};

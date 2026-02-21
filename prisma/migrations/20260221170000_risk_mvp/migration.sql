-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('waiting', 'in_progress', 'finished');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pseudo" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lobbyCode" TEXT NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'waiting',
    "currentTurnPlayerId" TEXT,
    "winnerPlayerId" TEXT,
    "turnNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "isAlive" BOOLEAN NOT NULL DEFAULT true,
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "reinforcements" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "svgId" TEXT NOT NULL,
    "adjacency" JSONB NOT NULL,
    "continent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameTerritoryState" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "ownerPlayerId" TEXT NOT NULL,
    "troops" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GameTerritoryState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameActionLog" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "actorPlayerId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_pseudo_key" ON "User"("pseudo");

-- CreateIndex
CREATE UNIQUE INDEX "Game_code_key" ON "Game"("code");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE INDEX "Game_lobbyCode_idx" ON "Game"("lobbyCode");

-- CreateIndex
CREATE INDEX "GamePlayer_gameId_userId_idx" ON "GamePlayer"("gameId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePlayer_gameId_seat_key" ON "GamePlayer"("gameId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_key_key" ON "Territory"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_svgId_key" ON "Territory"("svgId");

-- CreateIndex
CREATE INDEX "GameTerritoryState_gameId_ownerPlayerId_idx" ON "GameTerritoryState"("gameId", "ownerPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "GameTerritoryState_gameId_territoryId_key" ON "GameTerritoryState"("gameId", "territoryId");

-- CreateIndex
CREATE INDEX "GameActionLog_gameId_createdAt_idx" ON "GameActionLog"("gameId", "createdAt");

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTerritoryState" ADD CONSTRAINT "GameTerritoryState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTerritoryState" ADD CONSTRAINT "GameTerritoryState_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTerritoryState" ADD CONSTRAINT "GameTerritoryState_ownerPlayerId_fkey" FOREIGN KEY ("ownerPlayerId") REFERENCES "GamePlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameActionLog" ADD CONSTRAINT "GameActionLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameActionLog" ADD CONSTRAINT "GameActionLog_actorPlayerId_fkey" FOREIGN KEY ("actorPlayerId") REFERENCES "GamePlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


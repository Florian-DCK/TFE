export const MIN_REINFORCEMENTS = 3;

export function computeReinforcements(ownedTerritories, continentBonus = 0) {
  const base = Math.max(MIN_REINFORCEMENTS, Math.floor(Math.max(0, ownedTerritories) / 3));
  return base + Math.max(0, continentBonus);
}

function rollDie() {
  return 1 + Math.floor(Math.random() * 6);
}

export function resolveAttack(attackerTroops, defenderTroops, requestedAttackDice) {
  if (attackerTroops <= 1) {
    throw new Error("Not enough troops to attack.");
  }
  if (defenderTroops <= 0) {
    throw new Error("Defender must have troops.");
  }

  const maxAttackDice = Math.min(3, attackerTroops - 1);
  const attackDice = Math.min(Math.max(1, requestedAttackDice), maxAttackDice);
  const defendDice = Math.min(2, defenderTroops);

  const attackRolls = Array.from({ length: attackDice }, rollDie).sort((a, b) => b - a);
  const defenseRolls = Array.from({ length: defendDice }, rollDie).sort((a, b) => b - a);

  let attackerLosses = 0;
  let defenderLosses = 0;
  const comparisons = Math.min(attackRolls.length, defenseRolls.length);

  for (let i = 0; i < comparisons; i += 1) {
    if (attackRolls[i] > defenseRolls[i]) {
      defenderLosses += 1;
    } else {
      attackerLosses += 1;
    }
  }

  return {
    attackRolls,
    defenseRolls,
    attackerLosses,
    defenderLosses,
  };
}

export function canAttack(from, to, currentPlayerId, adjacencySet) {
  if (!from || !to) return false;
  if (from.ownerPlayerId !== currentPlayerId) return false;
  if (to.ownerPlayerId === currentPlayerId) return false;
  if (from.troops <= 1) return false;
  return adjacencySet.has(to.territoryKey);
}

export function canFortify(from, to, currentPlayerId, adjacencySet, troopsToMove) {
  if (!from || !to) return false;
  if (troopsToMove < 1) return false;
  if (from.ownerPlayerId !== currentPlayerId || to.ownerPlayerId !== currentPlayerId) return false;
  if (from.troops <= troopsToMove) return false;
  return adjacencySet.has(to.territoryKey);
}

export function checkVictory(players, territories) {
  const alivePlayers = players.filter((p) =>
    territories.some((t) => t.ownerPlayerId === p.id),
  );
  if (alivePlayers.length === 1) {
    return alivePlayers[0].id;
  }
  return null;
}

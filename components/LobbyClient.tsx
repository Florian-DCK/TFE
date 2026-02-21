"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/app/lib/socket";
import { useRouter } from "@/i18n/navigation";

type Member = { id: string; name: string; isHost?: boolean };
type MapOption = { key: string; name: string; version: number; territories: number };

export default function LobbyClient({
  code,
  displayName,
}: {
  code: string;
  displayName: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [selectedMapKey, setSelectedMapKey] = useState("world-simplified");
  const startDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    const s = getSocket();

    s.emit("join_lobby", { lobbyCode: code, name: displayName });

    const onLobbyState = (payload: {
      lobbyCode: string;
      members: Member[];
      gameCode: string | null;
    }) => {
      if (payload.lobbyCode !== code) return;
      setMembers(payload.members);
      setGameCode(payload.gameCode);
    };

    const onGameStarted = (payload: { lobbyCode: string; gameCode: string }) => {
      if (payload.lobbyCode !== code) return;
      if (startDeadlineRef.current) window.clearTimeout(startDeadlineRef.current);
      startDeadlineRef.current = null;
      setIsStarting(false);
      router.push(`/game/${payload.gameCode}`);
    };

    const onLobbyLocked = (payload: { lobbyCode: string; gameCode: string }) => {
      if (payload.lobbyCode !== code) return;
      router.push(`/game/${payload.gameCode}`);
    };

    const onRejected = (payload: { reason: string }) => {
      if (startDeadlineRef.current) window.clearTimeout(startDeadlineRef.current);
      startDeadlineRef.current = null;
      setError(payload.reason);
      setIsStarting(false);
    };
    const onServerInfo = (payload: { rev?: string }) => {
      setStatus(`Serveur: ${payload.rev ?? "unknown"}`);
    };
    const onMapsList = (payload: { maps?: MapOption[] }) => {
      const list = payload.maps ?? [];
      setMaps(list);
      setSelectedMapKey((prev) => (list.length > 0 && !list.some((m) => m.key === prev) ? list[0].key : prev));
    };
    const onConnect = () => setStatus(`Socket connecte: ${s.id}`);
    const onDisconnect = () => setStatus("Socket deconnecte");

    s.on("lobby_state", onLobbyState);
    s.on("game_started", onGameStarted);
    s.on("lobby_locked", onLobbyLocked);
    s.on("action_rejected", onRejected);
    s.on("server_info", onServerInfo);
    s.on("maps_list", onMapsList);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    if (s.connected) onConnect();

    return () => {
      s.off("lobby_state", onLobbyState);
      s.off("game_started", onGameStarted);
      s.off("lobby_locked", onLobbyLocked);
      s.off("action_rejected", onRejected);
      s.off("server_info", onServerInfo);
      s.off("maps_list", onMapsList);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.emit("leave_lobby", { lobbyCode: code });
    };
  }, [code, displayName, router]);

  const canStart = members.length >= 2 && !gameCode;

  const startGame = () => {
    setError(null);
    setIsStarting(true);
    setStatus("Envoi de start_game...");
    const s = getSocket();
    if (!s.connected) {
      setIsStarting(false);
      setError("Socket deconnecte. Recharge la page.");
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setIsStarting(false);
      setError("Aucune reponse du serveur. Verifie le terminal puis relance.");
    }, 5000);
    startDeadlineRef.current = timeout;

    s.emit(
      "start_game",
      { lobbyCode: code, mapKey: selectedMapKey },
      (response?: { ok?: boolean; gameCode?: string; reason?: string }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        startDeadlineRef.current = null;

        if (!response?.ok || !response.gameCode) {
          setIsStarting(false);
          setStatus("Reponse serveur: refus");
          setError(response?.reason || "Impossible de lancer la partie.");
          return;
        }

        setStatus("Reponse serveur: ok, redirection...");
        router.push(`/game/${response.gameCode}`);
      },
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <div>
        Lobby {code}
      </div>

      <h3 style={{ marginTop: 16 }}>Joueurs connectes ({members.length})</h3>
      <ul>
        {members.map((m) => (
          <li key={m.id}>
            {m.name}
            {m.isHost ? " (host)" : ""}
          </li>
        ))}
      </ul>

      <button onClick={startGame} disabled={!canStart || isStarting}>
        {isStarting ? "Lancement..." : "Lancer la partie"}
      </button>
      <div style={{ marginTop: 8 }}>
        <label htmlFor="map-key">Carte:</label>{" "}
        <select
          id="map-key"
          value={selectedMapKey}
          onChange={(e) => setSelectedMapKey(e.target.value)}
          disabled={isStarting}
        >
          {(maps.length > 0 ? maps : [{ key: "world-simplified", name: "Monde simplifie", version: 1, territories: 42 }]).map((map) => (
            <option key={map.key} value={map.key}>
              {map.name} (v{map.version}, {map.territories} territoires)
            </option>
          ))}
        </select>
      </div>

      {gameCode && <p>Partie en cours: {gameCode}</p>}
      {status && <p style={{ color: "#555" }}>{status}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!error && !canStart && (
        <p style={{ color: "#666" }}>
          {members.length < 2
            ? "Il faut au moins 2 joueurs pour lancer."
            : "Partie deja lancee."}
        </p>
      )}
    </div>
  );
}

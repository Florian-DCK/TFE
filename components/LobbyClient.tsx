"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/app/lib/socket";
import { useRouter } from "@/i18n/navigation";

type Member = { id: string; name: string; isHost?: boolean };
type MapOption = { key: string; name: string; version: number; territories: number };
function normalizeLobbyCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export default function LobbyClient({
  code,
  displayName,
}: {
  code: string;
  displayName: string;
}) {
  const router = useRouter();
  const normalizedCode = normalizeLobbyCode(code);
  const [members, setMembers] = useState<Member[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [selectedMapKey, setSelectedMapKey] = useState("world-simplified");
  const startDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    const s = getSocket();

    const onLobbyState = (payload: {
      lobbyCode: string;
      members: Member[];
      gameCode: string | null;
    }) => {
      if (normalizeLobbyCode(payload.lobbyCode) !== normalizedCode) return;
      setMembers(payload.members);
      setGameCode(payload.gameCode);
    };

    const onGameStarted = (payload: { lobbyCode: string; gameCode: string }) => {
      if (normalizeLobbyCode(payload.lobbyCode) !== normalizedCode) return;
      if (startDeadlineRef.current) window.clearTimeout(startDeadlineRef.current);
      startDeadlineRef.current = null;
      setIsStarting(false);
      const params = new URLSearchParams();
      params.set("name", displayName);
      router.push(`/game/${payload.gameCode}?${params.toString()}`);
    };

    const onLobbyLocked = (payload: { lobbyCode: string; gameCode: string }) => {
      if (normalizeLobbyCode(payload.lobbyCode) !== normalizedCode) return;
      router.push(`/game/${payload.gameCode}`);
    };

    const onRejected = (payload: { reason: string }) => {
      if (startDeadlineRef.current) window.clearTimeout(startDeadlineRef.current);
      startDeadlineRef.current = null;
      setError(payload.reason);
      setIsStarting(false);
    };
    const onMapsList = (payload: { maps?: MapOption[] }) => {
      const list = payload.maps ?? [];
      setMaps(list);
      setSelectedMapKey((prev) => (list.length > 0 && !list.some((m) => m.key === prev) ? list[0].key : prev));
    };

    s.on("lobby_state", onLobbyState);
    s.on("game_started", onGameStarted);
    s.on("lobby_locked", onLobbyLocked);
    s.on("action_rejected", onRejected);
    s.on("maps_list", onMapsList);
    s.emit("request_maps_list");
    s.emit("join_lobby", { lobbyCode: normalizedCode, name: displayName });

    return () => {
      s.off("lobby_state", onLobbyState);
      s.off("game_started", onGameStarted);
      s.off("lobby_locked", onLobbyLocked);
      s.off("action_rejected", onRejected);
      s.off("maps_list", onMapsList);
      s.emit("leave_lobby", { lobbyCode: normalizedCode });
    };
  }, [displayName, normalizedCode, router]);

  const canStart = members.length >= 2 && !gameCode;

  const startGame = () => {
    setError(null);
    setIsStarting(true);
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
      { lobbyCode: normalizedCode, mapKey: selectedMapKey },
      (response?: { ok?: boolean; gameCode?: string; reason?: string }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        startDeadlineRef.current = null;

        if (!response?.ok || !response.gameCode) {
          setIsStarting(false);
          setError(response?.reason || "Impossible de lancer la partie.");
          return;
        }

        const params = new URLSearchParams();
        params.set("name", displayName);
        router.push(`/game/${response.gameCode}?${params.toString()}`);
      },
    );
  };

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8">
      <div className="pointer-events-none absolute -left-20 top-8 h-56 w-56 rounded-full bg-amber-300/35 blur-3xl" />
      <div className="pointer-events-none absolute right-2 top-16 h-64 w-64 rounded-full bg-emerald-300/35 blur-3xl" />

      <section className="relative mx-auto grid max-w-5xl gap-4 lg:grid-cols-5">
        <div className="panel border-sky-200/80 bg-gradient-to-br from-sky-50 to-cyan-50 p-5 lg:col-span-2">
          <p className="chip border-sky-200 bg-sky-100 text-sky-800">Salon en attente</p>
          <h1 className="mt-3 text-3xl font-black text-slate-900">Lobby {code}</h1>
          <p className="mt-2 text-sm text-slate-700">
            Connecte comme <span className="font-semibold text-slate-900">{displayName}</span>.
          </p>

          <div className="mt-5">
            <label htmlFor="map-key" className="text-sm font-semibold text-slate-700">
              Carte
            </label>
            <select
              id="map-key"
              value={selectedMapKey}
              onChange={(e) => setSelectedMapKey(e.target.value)}
              disabled={isStarting}
              className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-emerald-300 transition focus:ring-2"
            >
              {(maps.length > 0
                ? maps
                : [{ key: "world-simplified", name: "Monde simplifie", version: 1, territories: 42 }]
              ).map((map) => (
                <option key={map.key} value={map.key}>
                  {map.name} (v{map.version}, {map.territories} territoires)
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={startGame}
            disabled={!canStart || isStarting}
            className="btn-primary mt-5 w-full bg-emerald-500 hover:bg-emerald-600"
          >
            {isStarting ? "Lancement..." : "Lancer la partie"}
          </button>

          {!error && !canStart && (
            <p className="mt-3 text-sm text-slate-600">
              {members.length < 2 ? "Il faut au moins 2 joueurs pour lancer." : "Partie deja lancee."}
            </p>
          )}

          {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
          {gameCode && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              Partie en cours: {gameCode}
            </p>
          )}
        </div>

        <div className="panel border-orange-200/80 bg-white/90 p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-slate-800">Joueurs connectes ({members.length})</h2>
            <span className="chip border-orange-200 bg-orange-100 text-orange-800">2 joueurs requis</span>
          </div>

          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-medium text-slate-800">{m.name}</span>
                {m.isHost ? (
                  <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Host</span>
                ) : (
                  <span className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">Joueur</span>
                )}
              </li>
            ))}
            {members.length === 0 && (
              <li className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                En attente de joueurs...
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

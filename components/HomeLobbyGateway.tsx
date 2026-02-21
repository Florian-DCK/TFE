"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";

function generateLobbyCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export default function HomeLobbyGateway({
  authenticatedPseudo,
}: {
  authenticatedPseudo: string | null;
}) {
  const router = useRouter();
  const [codeInput, setCodeInput] = useState("");
  const [guestPseudo, setGuestPseudo] = useState("Guest-Player");

  const effectivePseudo = useMemo(() => {
    if (authenticatedPseudo) return authenticatedPseudo;
    return guestPseudo.trim() || "Guest-Player";
  }, [authenticatedPseudo, guestPseudo]);

  const goToLobby = (codeRaw?: string) => {
    const lobbyCode = normalizeCode(codeRaw ?? codeInput);
    if (!lobbyCode) return;

    const params = new URLSearchParams();
    if (!authenticatedPseudo) {
      const guest = (guestPseudo.trim() || "Guest-Player").slice(0, 50);
      params.set("name", guest);
      window.localStorage.setItem("guest_pseudo", guest);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    router.push(`/lobby/${lobbyCode}${suffix}`);
  };

  const createLobby = () => {
    goToLobby(generateLobbyCode());
  };

  return (
    <section className="panel border-orange-200/80 bg-white/90 p-5">
      <h2 className="text-xl font-extrabold text-slate-800">Lancer une partie</h2>
      <p className="mt-1 text-sm text-slate-600">
        Pseudo actif: <span className="font-semibold text-slate-800">{effectivePseudo}</span>
      </p>

      {!authenticatedPseudo && (
        <div className="mt-4">
          <label htmlFor="guest-pseudo" className="text-sm font-semibold text-slate-700">
            Pseudo invite
          </label>
          <input
            id="guest-pseudo"
            value={guestPseudo}
            maxLength={50}
            onChange={(e) => setGuestPseudo(e.target.value)}
            placeholder="Guest-Player"
            className="mt-1 w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none ring-orange-300 transition focus:ring-2"
          />
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="lobby-code" className="text-sm font-semibold text-slate-700">
          Code du salon
        </label>
        <input
          id="lobby-code"
          value={codeInput}
          onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
          placeholder="Ex: AB12CD"
          className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm uppercase tracking-wider text-slate-800 outline-none ring-emerald-300 transition focus:ring-2"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn-primary bg-emerald-500 hover:bg-emerald-600" onClick={() => goToLobby()} disabled={!normalizeCode(codeInput)}>
          Rejoindre un salon
        </button>
        <button className="btn-secondary border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100" onClick={createLobby}>
          Creer un nouveau salon
        </button>
      </div>
    </section>
  );
}

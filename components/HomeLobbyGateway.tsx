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
    <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
      <h2>Jouer</h2>
      <p>Pseudo actif: {effectivePseudo}</p>

      {!authenticatedPseudo && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="guest-pseudo">Pseudo invite</label>
          <input
            id="guest-pseudo"
            value={guestPseudo}
            maxLength={50}
            onChange={(e) => setGuestPseudo(e.target.value)}
            placeholder="Guest-Player"
            style={{ display: "block", marginTop: 6 }}
          />
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label htmlFor="lobby-code">Code du salon</label>
        <input
          id="lobby-code"
          value={codeInput}
          onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
          placeholder="Ex: AB12CD"
          style={{ display: "block", marginTop: 6, textTransform: "uppercase" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => goToLobby()} disabled={!normalizeCode(codeInput)}>
          Rejoindre un salon
        </button>
        <button onClick={createLobby}>Creer un nouveau salon</button>
      </div>
    </section>
  );
}

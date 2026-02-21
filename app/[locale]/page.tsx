import { getCurrentUser, logout } from "../actions/auth";
import { Link } from "@/i18n/navigation";
import HomeLobbyGateway from "@/components/HomeLobbyGateway";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getCurrentUser();

  return (
    <main style={{ padding: 20, display: "grid", gap: 16, maxWidth: 720 }}>
      <h1>Risk-like Web Game</h1>

      {user ? (
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <p>Connecte en tant que {user.pseudo}</p>
          <form action={logout}>
            <button type="submit">Se deconnecter</button>
          </form>
        </section>
      ) : (
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <p>Connecte-toi ou continue avec un pseudo invite.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/login" locale={locale}>
              Se connecter
            </Link>
            <Link href="/register" locale={locale}>
              Creer un compte
            </Link>
          </div>
        </section>
      )}

      <HomeLobbyGateway authenticatedPseudo={user?.pseudo ?? null} />
    </main>
  );
}

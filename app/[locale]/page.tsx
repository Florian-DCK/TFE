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
    <main className="relative min-h-screen overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute -left-24 top-8 h-64 w-64 rounded-full bg-amber-300/40 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-20 h-72 w-72 rounded-full bg-emerald-300/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-sky-300/40 blur-3xl" />

      <section className="relative mx-auto grid max-w-5xl gap-5 lg:grid-cols-2">
        <div className="panel border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50 p-7">
          <span className="chip border-amber-200 bg-amber-100 text-amber-800">Multijoueur temps reel</span>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-900">Risk-like Web Game</h1>
          <p className="mt-3 text-base text-slate-700">
            Cree un salon, invite un ami, et lance une partie strategique en quelques secondes.
          </p>

          {user ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-slate-700">
                Connecte en tant que <span className="font-bold text-slate-900">{user.pseudo}</span>
              </p>
              <form action={logout}>
                <button type="submit" className="btn-secondary border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
                  Se deconnecter
                </button>
              </form>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-sm text-slate-700">Connecte-toi ou continue en mode invite.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/login" locale={locale} className="btn-primary bg-sky-500 hover:bg-sky-600">
                  Se connecter
                </Link>
                <Link href="/register" locale={locale} className="btn-secondary border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100">
                  Creer un compte
                </Link>
              </div>
            </div>
          )}
        </div>

        <HomeLobbyGateway authenticatedPseudo={user?.pseudo ?? null} />
      </section>
    </main>
  );
}

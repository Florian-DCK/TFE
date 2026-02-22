import { getCurrentUser, logout } from "../actions/auth";
import { Link } from "@/i18n/navigation";
import HomeLobbyGateway from "@/components/HomeLobbyGateway";
import Image from "next/image";

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
              <div className="flex flex-wrap gap-2">
                <Link href="/map-editor" locale={locale} className="btn-secondary border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                  Editeur de carte
                </Link>
              </div>
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
                <Link href="/map-editor" locale={locale} className="btn-secondary border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                  Editeur de carte
                </Link>
              </div>
            </div>
          )}
        </div>

        <HomeLobbyGateway authenticatedPseudo={user?.pseudo ?? null} />
      </section>

      <section className="relative mx-auto mt-6 max-w-5xl">
        <div className="panel border-sky-200/70 bg-white/90 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="chip border-sky-200 bg-sky-100 text-sky-800">Tutoriel rapide</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Comment jouer</h2>
              <p className="mt-1 text-sm text-slate-600">4 etapes pour lancer une partie et comprendre le tour de jeu.</p>
            </div>
            <div className="hidden h-20 w-40 overflow-hidden rounded-xl border border-sky-200 bg-sky-50 sm:block">
              <Image
                src="/maps/world-simplified/board.svg"
                alt="Apercu carte du jeu"
                width={320}
                height={160}
                className="h-full w-full object-cover opacity-85"
              />
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Etape 1</p>
              <h3 className="mt-1 text-base font-extrabold text-slate-900">Creer ou rejoindre un salon</h3>
              <p className="mt-2 text-sm text-slate-700">Saisis un code pour rejoindre un ami, ou cree un nouveau salon automatiquement.</p>
            </article>

            <article className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Etape 2</p>
              <h3 className="mt-1 text-base font-extrabold text-slate-900">Place tes renforts</h3>
              <p className="mt-2 text-sm text-slate-700">Au debut de ton tour, ajoute toutes tes troupes de renfort sur tes territoires.</p>
            </article>

            <article className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-rose-700">Etape 3</p>
              <h3 className="mt-1 text-base font-extrabold text-slate-900">Attaque les voisins</h3>
              <p className="mt-2 text-sm text-slate-700">Attaque un territoire adjacent ennemi. Les des decident des pertes et des captures.</p>
            </article>

            <article className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Etape 4</p>
              <h3 className="mt-1 text-base font-extrabold text-slate-900">Fortifie puis termine</h3>
              <p className="mt-2 text-sm text-slate-700">Deplace des troupes entre tes territoires connectes, puis termine ton tour.</p>
            </article>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Objectif:</span> eliminer ton adversaire en prenant tous ses territoires.
          </div>
        </div>
      </section>
    </main>
  );
}

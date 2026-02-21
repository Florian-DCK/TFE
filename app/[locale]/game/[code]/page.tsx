import { getCurrentUser } from "@/app/actions/auth";
import GameClient from "@/components/GameClient";

function generateGuestPseudo() {
  const adjectives = ["Swift", "Brave", "Lucky", "Silent", "Nova", "Crimson"];
  const animals = ["Fox", "Wolf", "Otter", "Falcon", "Panda", "Lynx"];
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const suffix = Math.floor(100 + Math.random() * 900);
  return `Guest-${adjective}${animal}${suffix}`;
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  const user = await getCurrentUser();
  const displayName = user?.pseudo || generateGuestPseudo();

  return <GameClient locale={locale} code={code} displayName={displayName} />;
}

import { getCurrentUser } from "../actions/auth";
export default async function Home() {
  const user = await getCurrentUser();
  return (
    <main>
      <p>Salut {user?.pseudo}</p>
    </main>
  );
}

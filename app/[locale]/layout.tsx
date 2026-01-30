import type { Metadata } from 'next';
import './globals.css';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';

export const metadata: Metadata = {
	title: 'New App',
	description: 'Template par défaut Prisma et NextIntl',
};

export default async function RootLayout({
	children,
	params,
}: Readonly<{
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}>) {
	const { locale } = await params;
	if (!hasLocale(routing.locales, locale)) {
		notFound();
	}

	// Charge les messages de traduction pour la locale demandée.
	let messages: Record<string, unknown> | undefined;
	try {
		// Le chemin relatif depuis `app/[locale]/layout.tsx` vers `messages/{locale}.json`
		messages = (await import(`../../messages/${locale}.json`)).default;
	} catch {
		// Si les messages ne sont pas trouvés, afficher 404 (ou gérer autrement)
		notFound();
	}

	return (
		<html lang={locale}>
			<body className={`antialiased`}>
				<NextIntlClientProvider locale={locale} messages={messages}>
					{children}
				</NextIntlClientProvider>
			</body>
		</html>
	);
}

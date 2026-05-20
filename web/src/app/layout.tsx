import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { DEFAULT_REGULATOR_SCHEMA } from '@/lib/regulator-schemas';
import './globals.css';

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
});

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
});

export const metadata: Metadata = {
	title: DEFAULT_REGULATOR_SCHEMA.home.title,
	description: 'Interactive FINRA/SEC relationship graph explorer powered by Cosmograph.',
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang='en'
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
			<body className='min-h-full flex flex-col'>{children}</body>
		</html>
	);
}

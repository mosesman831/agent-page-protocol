import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Page Protocol — web pages for agents, rendered for humans',
  description:
    'APP replaces HTML/DOM as the unit a page serves: a typed JSON page manifest with declared actions. One document — agents read it, the Chrome extension renders it.',
  alternates: {
    types: { 'application/vnd.agent-page+json': '/manifest.app.json' },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

'use client';

import { useState } from 'react';

export default function CopyBtn({
  code,
  children,
  className = 'btn btn-pri',
}: {
  code: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — leave button state unchanged */
    }
  };

  return (
    <button className={className} onClick={copy} type="button">
      {copied ? 'copied ✓' : children}
    </button>
  );
}

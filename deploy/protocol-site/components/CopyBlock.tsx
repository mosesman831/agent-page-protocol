'use client';

import { useState } from 'react';

export default function CopyBlock({ code, label }: { code: string; label?: string }) {
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
    <div className="term">
      <div className="term-bar">
        <i />
        <i />
        <i />
        <span className="term-label">{label}</span>
        <button className="copy" onClick={copy} type="button">
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

'use client';

import dynamic from 'next/dynamic';

const ShaderGradientCanvas = dynamic(
  () => import('@shadergradient/react').then((m) => m.ShaderGradientCanvas),
  { ssr: false },
);
const ShaderGradient = dynamic(
  () => import('@shadergradient/react').then((m) => m.ShaderGradient),
  { ssr: false },
);

export default function ShaderHero() {
  return (
    <div className="shader-wrap" aria-hidden>
      <ShaderGradientCanvas
        pointerEvents="none"
        pixelDensity={1}
        lazyLoad={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        <ShaderGradient
          type="waterPlane"
          animate="on"
          uSpeed={0.22}
          uStrength={1.8}
          uDensity={1.5}
          uFrequency={5.5}
          uAmplitude={3.2}
          color1="#2b1608"
          color2="#f08a4b"
          color3="#171028"
          brightness={0.75}
          reflection={0.35}
        />
      </ShaderGradientCanvas>
      <div className="shader-veil" />
    </div>
  );
}

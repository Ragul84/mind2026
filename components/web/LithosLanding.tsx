import React, { useEffect, useMemo, useRef, useState } from 'react';

const BG_IMAGE_1 =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_195923_b0ba8ace-1d1d-4f2c-9a28-1ab84b330680.png&w=1280&q=85';
const BG_IMAGE_2 =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_201152_bba90a12-bf12-459f-91f0-51f237dbaf3b.png&w=1280&q=85';
const SPOTLIGHT_R = 260;

const LITHOS_STYLE_ID = 'lithos-landing-styles';

const lithosCss = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@1,400;1,500;1,600&display=swap');
* { font-family: 'Inter', sans-serif; box-sizing: border-box; }
.font-playfair { font-family: 'Playfair Display', serif; }
@keyframes heroReveal { 0%{opacity:0;transform:translateY(28px);filter:blur(12px)} 100%{opacity:1;transform:translateY(0);filter:blur(0)} }
@keyframes heroFadeUp { 0%{opacity:0;transform:translateY(20px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes heroZoom { 0%{transform:scale(1.12)} 100%{transform:scale(1)} }
.hero-anim { opacity:0; animation-fill-mode:forwards; animation-timing-function:cubic-bezier(0.16,1,0.3,1); }
.hero-reveal { animation-name:heroReveal; animation-duration:1.1s; }
.hero-fade { animation-name:heroFadeUp; animation-duration:1s; }
.hero-zoom { animation:heroZoom 1.8s cubic-bezier(0.16,1,0.3,1) forwards; }
@media (prefers-reduced-motion: reduce){ .hero-anim,.hero-zoom{ animation:none; opacity:1; } }

.lithos-root {
  min-height: 100vh;
  background: #ffffff;
  letter-spacing: -0.02em;
  font-family: 'Inter', sans-serif;
}
.lithos-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
}
.lithos-nav-pill-btn,
.lithos-signup-btn,
.lithos-start-btn,
.lithos-menu-btn {
  appearance: none;
  border: 0;
  outline: 0;
  cursor: pointer;
}
.lithos-nav-pill-btn {
  background: transparent;
  color: rgba(255,255,255,0.8);
  padding: 0.375rem 1rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background-color 160ms ease, color 160ms ease;
}
.lithos-nav-pill-btn:hover {
  background: rgba(255,255,255,0.2);
  color: #ffffff;
}
.lithos-nav-pill-btn.active {
  background: rgba(255,255,255,0.95);
  color: #111827;
}
.lithos-signup-btn {
  background: #ffffff;
  color: #111827;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.625rem 1.5rem;
  border-radius: 999px;
  transition: background-color 160ms ease;
}
.lithos-signup-btn:hover { background: #f3f4f6; }
.lithos-start-btn {
  background: #e8702a;
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.75rem 1.75rem;
  border-radius: 999px;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
}
.lithos-start-btn:hover {
  background: #d2611f;
  transform: scale(1.03);
  box-shadow: 0 18px 38px rgba(232, 112, 42, 0.3);
}
.lithos-start-btn:active { transform: scale(0.95); }
.lithos-menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  border: 1px solid rgba(255,255,255,0.18);
  backdrop-filter: blur(14px);
  color: #ffffff;
}
.lithos-mobile-only { display: none; }
.lithos-desktop-only { display: block; }
.lithos-sm-only { display: none; }
.lithos-bottom-right {
  position: absolute;
  bottom: 2.5rem;
  left: 1.25rem;
  right: 1.25rem;
  z-index: 50;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
}

@media (max-width: 767px) {
  .lithos-mobile-only { display: flex; }
  .lithos-desktop-only { display: none !important; }
  .lithos-menu-btn { display: inline-flex; }
}

@media (min-width: 640px) {
  .lithos-sm-only { display: block; }
  .lithos-bottom-right {
    bottom: 6rem;
    left: auto;
    right: 2.5rem;
    max-width: 260px;
    gap: 1.25rem;
  }
}

@media (min-width: 768px) {
  .lithos-nav { padding: 20px; }
}
`;

function useLithosStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(LITHOS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LITHOS_STYLE_ID;
    style.textContent = lithosCss;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);
}

type RevealLayerProps = {
  image: string;
  cursorX: number;
  cursorY: number;
};

function RevealLayer({ image, cursorX, cursorY }: RevealLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [maskUrl, setMaskUrl] = useState<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (cursorX < -900 || cursorY < -900) {
      setMaskUrl('');
      return;
    }

    const gradient = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, SPOTLIGHT_R);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(0.75, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(0.88, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, SPOTLIGHT_R, 0, Math.PI * 2);
    ctx.fill();

    setMaskUrl(canvas.toDataURL());
  }, [cursorX, cursorY]);

  const revealStyle = useMemo<React.CSSProperties>(() => ({
    position: 'absolute',
    inset: 0,
    backgroundImage: `url(${image})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
    backgroundRepeat: 'no-repeat',
    zIndex: 30,
    pointerEvents: 'none',
    WebkitMaskImage: maskUrl ? `url(${maskUrl})` : 'none',
    maskImage: maskUrl ? `url(${maskUrl})` : 'none',
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
  }), [image, maskUrl]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'none' }}
      />
      <div style={revealStyle} />
    </>
  );
}

function LithosWordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg width="26" height="26" viewBox="0 0 256 256" aria-hidden="true">
        <path
          fill="#ffffff"
          d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z"
        />
      </svg>
      <span className="text-white text-2xl font-playfair italic" style={{ color: '#ffffff', fontSize: '1.5rem' }}>
        Lithos
      </span>
    </div>
  );
}

function MobileMenuButton() {
  return (
    <button className="lithos-menu-btn lithos-mobile-only" aria-label="Open menu" type="button">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 12H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export default function LithosLanding() {
  useLithosStyles();

  const mouse = useRef({ x: -999, y: -999 });
  const smooth = useRef({ x: -999, y: -999 });
  const rafRef = useRef<number | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: -999, y: -999 });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };

    const animate = () => {
      smooth.current.x += (mouse.current.x - smooth.current.x) * 0.1;
      smooth.current.y += (mouse.current.y - smooth.current.y) * 0.1;
      setCursorPos({
        x: smooth.current.x,
        y: smooth.current.y,
      });
      rafRef.current = window.requestAnimationFrame(animate);
    };

    window.addEventListener('mousemove', onMove);
    rafRef.current = window.requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      className="lithos-root"
      style={{
        minHeight: '100vh',
        background: '#ffffff',
        letterSpacing: '-0.02em',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <nav className="lithos-nav">
        <LithosWordmark />

        <div
          className="lithos-desktop-only"
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.2)',
            backdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 999,
            padding: '8px',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" className="lithos-nav-pill-btn active">Course</button>
            <button type="button" className="lithos-nav-pill-btn">Field Guides</button>
            <button type="button" className="lithos-nav-pill-btn">Geology</button>
            <button type="button" className="lithos-nav-pill-btn">Plans</button>
            <button type="button" className="lithos-nav-pill-btn">Live Tour</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="lithos-signup-btn lithos-desktop-only">Sign Up</button>
          <MobileMenuButton />
        </div>
      </nav>

      <section
        style={{
          position: 'relative',
          width: '100%',
          overflow: 'hidden',
          height: '100dvh',
          background: '#000000',
        }}
      >
        <div
          className="hero-zoom"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            backgroundImage: `url(${BG_IMAGE_1})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
          }}
        />

        <RevealLayer image={BG_IMAGE_2} cursorX={cursorPos.x} cursorY={cursorPos.y} />

        <div
          style={{
            position: 'absolute',
            top: '14%',
            left: 0,
            right: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '0 20px',
            pointerEvents: 'none',
          }}
        >
          <h1 style={{ color: '#ffffff', lineHeight: 0.95, margin: 0 }}>
            <span
              className="font-playfair hero-anim hero-reveal"
              style={{
                display: 'block',
                fontStyle: 'italic',
                fontWeight: 400,
                fontSize: 'clamp(3rem, 7vw, 6rem)',
                letterSpacing: '-0.05em',
                animationDelay: '0.25s',
              }}
            >
              Layers hold
            </span>
            <span
              className="hero-anim hero-reveal"
              style={{
                display: 'block',
                fontWeight: 400,
                fontSize: 'clamp(3rem, 7vw, 6rem)',
                marginTop: '-0.25rem',
                letterSpacing: '-0.08em',
                animationDelay: '0.42s',
              }}
            >
              tales of time
            </span>
          </h1>
        </div>

        <div
          className="hero-anim hero-fade lithos-sm-only"
          style={{
            position: 'absolute',
            bottom: '3.5rem',
            left: '3.5rem',
            zIndex: 50,
            maxWidth: 260,
            animationDelay: '0.7s',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.7, margin: 0 }}>
            Every layer of sediment records a chapter of our planet, from ancient seabeds to drifting ash,
            layered across millions of years beneath us.
          </p>
        </div>

        <div
          className="hero-anim hero-fade lithos-bottom-right"
          style={{
            animationDelay: '0.85s',
          }}
        >
          <p
            style={{
              margin: 0,
              maxWidth: 260,
              fontSize: '0.875rem',
              color: 'rgba(255,255,255,0.8)',
              lineHeight: 1.7,
            }}
          >
            Our interactive maps let you peel back the crust to trace how stones, fossils, and deep time
            combine to shape the ground beneath your feet.
          </p>
          <button type="button" className="lithos-start-btn">
            Start Digging
          </button>
        </div>
      </section>

    </div>
  );
}

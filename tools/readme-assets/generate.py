"""Generates the README art in docs/assets/.

Usage: python3 tools/readme-assets/generate.py <current-phase>
Run it at every phase boundary so the roadmap constellation lights up the new phase.
"""

import math
import sys
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[2] / "docs" / "assets"
SANS = "Figtree, 'Segoe UI Variable Display', 'Segoe UI', Inter, system-ui, sans-serif"
MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"
PHASES = [
    "Foundations", "Core + glass", "Social & DMs", "Servers & roles", "Voice & video",
    "Profiles", "Widgets & themes", "Polish", "Hardening", "Stretch",
]
EASE = 'calcMode="spline" keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"'


def hero(dark: bool) -> str:
    base = "#0A0C16" if dark else "#EEF3FB"
    blobs = (
        [("#4FD8FF", 300, 170, 230), ("#8B7BFF", 640, 250, 260), ("#FF6BD6", 980, 150, 220), ("#6C8CFF", 820, 330, 200)]
        if dark
        else [("#9FD8FF", 300, 170, 240), ("#C7B8FF", 640, 260, 260), ("#FFC2EC", 980, 150, 220), ("#A9BDFF", 820, 330, 200)]
    )
    drift = [(60, 30, 18), (-80, -40, 22), (-50, 50, 26), (70, -30, 20)]
    ink, sub = ("#F4F6FF", "#C9D1EE") if dark else ("#0E1430", "#3F4A6E")
    glass = "rgba(255,255,255,0.07)" if dark else "rgba(255,255,255,0.45)"
    rim_a = "rgba(255,255,255,0.55)" if dark else "rgba(255,255,255,0.95)"
    rim_b = "rgba(255,255,255,0.04)" if dark else "rgba(120,140,190,0.25)"
    shadow, shadow_alpha = ("#1B1F4A", 0.55) if dark else ("#8EA2D8", 0.35)
    blob_svg = "".join(
        f'\n      <circle cx="{x}" cy="{y}" r="{r}" fill="{c}" opacity="{0.55 if dark else 0.7}">'
        f'<animateTransform attributeName="transform" type="translate" values="0 0; {dx} {dy}; 0 0" '
        f'dur="{dur}s" repeatCount="indefinite" {EASE}/></circle>'
        for (c, x, y, r), (dx, dy, dur) in zip(blobs, drift)
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="420" viewBox="0 0 1280 420" role="img" aria-label="SilverCord">
  <defs>
    <filter id="aurora" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/></filter>
    <filter id="soft" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="{shadow}" flood-opacity="{shadow_alpha}"/></filter>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{rim_a}"/><stop offset="0.45" stop-color="{rim_b}"/><stop offset="1" stop-color="{rim_a}" stop-opacity="0.35"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="{0.22 if dark else 0.6}"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
    <radialGradient id="spec" cx="0" cy="0" r="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="{0.35 if dark else 0.8}"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
    <clipPath id="frame"><rect width="1280" height="420" rx="28"/></clipPath>
    <clipPath id="card"><rect x="290" y="105" width="700" height="210" rx="56"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="1280" height="420" fill="{base}"/>
    <g filter="url(#aurora)">{blob_svg}
    </g>
    <rect width="1280" height="420" filter="url(#grain)"/>
    <g filter="url(#soft)"><rect x="290" y="105" width="700" height="210" rx="56" fill="{glass}"/></g>
    <g clip-path="url(#card)">
      <rect x="290" y="105" width="700" height="105" fill="url(#sheen)"/>
      <ellipse cx="0" cy="0" rx="260" ry="140" fill="url(#spec)"><animateTransform attributeName="transform" type="translate" values="360 110; 920 140; 360 110" dur="14s" repeatCount="indefinite" {EASE}/></ellipse>
    </g>
    <rect x="290.75" y="105.75" width="698.5" height="208.5" rx="55.25" fill="none" stroke="url(#rim)" stroke-width="1.5"/>
    <text x="640" y="222" text-anchor="middle" font-family="{SANS}" font-size="76" font-weight="650" letter-spacing="-2.5" fill="{ink}">SilverCord</text>
    <text x="640" y="268" text-anchor="middle" font-family="{SANS}" font-size="21" font-weight="450" fill="{sub}">Your own voice, video and chat.</text>
  </g>
</svg>
"""


def roadmap(current: int) -> str:
    width, height = 1280, 240
    points = [(90 + i * (1100 / 9), 120 + math.sin(i * 1.1) * 18) for i in range(len(PHASES))]
    trail = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in points)
    done = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in points[: current + 1])
    nodes = []
    for i, ((x, y), name) in enumerate(zip(points, PHASES)):
        lit, now = i < current, i == current
        label_y = y + 50 if i % 2 == 0 else y - 46
        if now:
            nodes.append(
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="24" fill="#4FD8FF" opacity="0.2">'
                '<animate attributeName="r" values="18;30;18" dur="3.2s" repeatCount="indefinite"/>'
                '<animate attributeName="opacity" values="0.3;0.05;0.3" dur="3.2s" repeatCount="indefinite"/></circle>'
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" fill="url(#orb)" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="1.2"/>'
            )
        elif lit:
            nodes.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="url(#orb)"/>')
        else:
            nodes.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="#141831" stroke="#8B7BFF" stroke-opacity="0.55" stroke-width="1.2"/>')
        bright = lit or now
        nodes.append(
            f'<text x="{x:.1f}" y="{label_y:.1f}" text-anchor="middle" font-family="{MONO}" font-size="12" fill="{"#4FD8FF" if bright else "#6E78A0"}">{i}</text>'
            f'<text x="{x:.1f}" y="{label_y + 18:.1f}" text-anchor="middle" font-family="{SANS}" font-size="15" '
            f'font-weight="{600 if now else 450}" fill="{"#F4F6FF" if bright else "#A9B3D6"}">{escape(name)}</text>'
        )
    body = "\n  ".join(nodes)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Roadmap: phase {current} of 9 in progress">
  <defs>
    <radialGradient id="orb" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#4FD8FF"/><stop offset="1" stop-color="#6C8CFF"/></radialGradient>
    <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#4FD8FF"/><stop offset="1" stop-color="#FF6BD6"/></linearGradient>
  </defs>
  <rect width="{width}" height="{height}" rx="28" fill="#0A0C16"/>
  <path d="{trail}" fill="none" stroke="#8B7BFF" stroke-opacity="0.3" stroke-width="1.5" stroke-dasharray="3 7"/>
  <path d="{done}" fill="none" stroke="url(#fade)" stroke-width="2.5" stroke-linecap="round"/>
  {body}
</svg>
"""


def main() -> None:
    current = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hero-dark.svg").write_text(hero(dark=True))
    (OUT / "hero-light.svg").write_text(hero(dark=False))
    (OUT / "roadmap.svg").write_text(roadmap(current))


if __name__ == "__main__":
    main()

# HQ Strikepro — Design System

Dark-first mobile web app for a Thai trading/investment community. All pages are single-file HTML with inline CSS. Mobile-first, max-width container, no external CSS framework.

---

## Fonts

| Context | Family | Notes |
|---|---|---|
| Most pages | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | System stack |
| Reviews page | `Inter` (Google Fonts) | Loaded via `<link>` |

Global: `-webkit-font-smoothing: antialiased`, `overflow-x: hidden`

---

## Core CSS Variables

Every page defines a `:root` block. Common tokens:

```css
:root {
  --nav-h:     56px;
  --radius:    14px;
  --radius-sm: 8px–10px;   /* varies by page */

  --bg:        #0c0c0c – #0d0d0d;
  --surface:   #131313 – #1a1a1a;
  --surface2:  #1e1e1e – #222;
  --border:    rgba(255,255,255,.07) – #2e2e2e;

  --text:      #f0f0f0 – #f1f1f1;
  --text-muted:#777 – #8a8a8a;
  --text-sub:  #555 – #666;
}
```

---

## Accent Colors per Page

Each page has its own `--accent` / named color pair + dim/mid/border variants:

| Page | Primary | Hex | Dim (bg tint) | Mid (border) |
|---|---|---|---|---|
| Home | Red | `#E63946` | `rgba(230,57,70,.12)` | `rgba(230,57,70,.25)` |
| PPVP | Indigo | `#818cf8` | `rgba(129,140,248,.12)` | `rgba(129,140,248,.25)` |
| HQ Ultimate | Gold | `#d4af37` | `rgba(212,175,55,.12)` | `rgba(212,175,55,.25)` |
| Golden Boy | Green | `#4ade80` | `rgba(74,222,128,.12)` | `rgba(74,222,128,.25)` |
| STP Coin | Amber | `#f59e0b` | `rgba(245,158,11,.12)` | `rgba(245,158,11,.25)` |
| Free Education | Sky | `#38bdf8` | `rgba(56,189,248,.12)` | `rgba(56,189,248,.25)` |
| Valhalla Dungeon | Gold + Crimson | `#d4af37` / `#dc2626` | warm brown tones | `rgba(212,175,55,.25)` |
| Charity Project | Blue + Gold | `#60a5fa` / `#f59e0b` | navy tones | `rgba(96,165,250,.25)` |
| Reviews | Gold | `#d4af37` | `rgba(212,175,55,.15)` | `rgba(212,175,55,.25)` |

### Dim / Mid convention
```
--accent:        #xxxxxx
--accent-dim:    rgba(r,g,b,.12–.15)   ← card background tint
--accent-mid:    rgba(r,g,b,.25–.30)   ← card border
--accent-border: rgba(r,g,b,.22–.28)   ← subtle border
```

### LINE CTA green
```css
--green: #22c55e  (button bg)
```

---

## Typography Scale

| Role | Size | Weight | Notes |
|---|---|---|---|
| Hero title | `34–38px` | `900` | letter-spacing `-1px`, gradient text |
| Section title | `20–22px` | `800` | |
| Card title | `15–16px` | `700–800` | |
| Body | `14–15px` | `500–600` | line-height `1.6` |
| Small label | `10–12px` | `700` | uppercase, letter-spacing `1–1.5px` |
| Muted caption | `11–12px` | `400–500` | color `--text-muted` |

---

## Layout

```
max-width: 480–560px
margin: 0 auto
padding: 0 16px
padding-bottom: 80–100px   ← buffer for fixed LINE CTA
```

Page sections: `padding: 36px 16px`  
Section divider: `<hr class="section-divider">` — `1px solid var(--border)`

---

## Navigation

### Top Nav (all public sub-pages)

```html
<nav class="top-nav">
  <a class="nav-back" href="/" id="navBackBtn">
    <svg>← chevron</svg>
    Back
  </a>
  <button class="hamburger" id="navHamburgerBtn" style="display:none">
    <!-- shown only for logged-in users -->
  </button>
  <span class="nav-title">Page Name</span>
  <button class="nav-share" onclick="sharePage()">
    <!-- share icon, always visible -->
  </button>
</nav>
```

```css
.top-nav {
  position: fixed; top: 0; left: 0; right: 0;
  height: var(--nav-h);           /* 56px */
  background: rgba(13,13,13,.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center;
  padding: 0 16px; gap: 12px;
}
.nav-back  { /* left */  flex-shrink: 0; }
.nav-title { /* center */ flex: 1; text-align: center; }
.nav-share { /* right */  margin-left: auto; margin-right: -8px; }
```

**Logic** — JS at bottom of each page:  
- Logged-in users → hide back button, show hamburger + drawer  
- Public users → show back button, hide hamburger

### Home nav (index.html)
Uses the same fixed-nav pattern but with logo instead of back button, no hamburger visible to public.

### Drawer (logged-in only)
- Slides in from left, width `275px`  
- `.28s cubic-bezier(.4,0,.2,1)` animation  
- Sections: Dashboard, Clients, Products, Ecosystem (accordion), Events (accordion)

---

## Cards

### Standard card
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);   /* 14px */
  padding: 20px;
  margin-bottom: 14px;
}
```

### Accent card (colored border)
```css
border-color: var(--accent-mid);
background: linear-gradient(135deg, var(--accent-dim) 0%, var(--surface) 60%);
```
Top gradient line decoration:
```css
.card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
```

### Strategy card (product list on home)
```css
.strategy-card {
  display: flex; gap: 14px; align-items: center;
  padding: 16px 14px;
  border: 1px solid var(--border);
  border-radius: 14px;
  border-left: 4px solid var(--accent);  /* colored left bar */
}
```

### Eco card (ecosystem grid on home)
```css
.eco-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.eco-card { padding: 16px 14px; border-radius: 14px; }
```

---

## Buttons

### Primary CTA (gold)
```css
background: linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 100%);
color: #0c0c0c;
font-weight: 800;
border-radius: var(--radius-sm);
padding: 13–14px;
width: 100%;
```

### LINE CTA button (fixed bottom)
```css
.line-cta {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 90;
  padding: 12px 16px 20px;
  background: linear-gradient(to top, rgba(13,13,13,1) 70%, transparent);
}
.line-btn {
  background: #06c755;
  color: #fff;
  border-radius: 10–12px;
  padding: 13–14px;
  width: 100%;
  font-size: 15px; font-weight: 700;
}
```

### Outline button
```css
background: transparent;
border: 1px solid var(--accent-mid);
color: var(--accent);
```

---

## Grids

| Pattern | Columns | Gap | Breakpoint |
|---|---|---|---|
| Eco grid | `1fr 1fr` | `10px` | → 1 col at `340px` |
| Feature grid | `1fr 1fr` | `10px` | → 1 col at `380px` |
| Quick stats | `repeat(4,1fr)` | — | → `repeat(2,1fr)` at `480px` |
| Benefit grid | `1fr 1fr` | `10px` | — |

---

## Reusable Components

### Quote block
```css
border-left: 3px solid var(--accent);
padding: 12px 16px;
background: var(--accent-dim);
border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
font-style: italic; font-weight: 600;
```

### Bullet / check list
```css
.bullet-list li::before { content: '•'; color: var(--accent); }
.check-list  li::before { content: '✓'; color: var(--green);  }
```

### Step number circle
```css
width: 28px; height: 28px; border-radius: 50%;
background: var(--accent); color: #000; font-weight: 800;
```

### Section label (eyebrow text)
```css
font-size: 10–11px; font-weight: 700;
letter-spacing: 1–1.5px; text-transform: uppercase;
color: var(--accent);
```

### Value / stat box
```css
background: var(--accent-dim);
border: 1px solid var(--accent-mid);
padding: 16px; border-radius: var(--radius-sm);
/* number: 32px weight 900, accent color */
/* label:  13px muted */
```

### Feature grid item
```css
background: var(--surface2);
border: 1px solid var(--border);
padding: 14px 12px; border-radius: var(--radius-sm);
/* icon: 22px emoji */
/* name: 13px weight 700 accent */
/* desc: 11px muted */
```

### Review star (1–5)
```css
.star.filled { color: var(--gold); }
.star.empty  { color: #2a2a2a; }
font-size: 24px (interactive) / 14px (display)
```

---

## Transitions & Animation

| Element | Duration | Property |
|---|---|---|
| Hover color/bg | `0.15s` | `color`, `background` |
| Hover border | `0.15s–0.18s` | `border-color` |
| Hover lift | `0.12s` | `transform: translateY(-1px)` |
| Active press | `0.1s` | `transform: scale(.97–.98)` |
| Drawer slide | `0.28s cubic-bezier(.4,0,.2,1)` | `transform` |
| Modal entrance | `0.2s ease` | `opacity`, `translateY(12px→0)` |
| Pulse badge | `2s ease-in-out infinite` | `opacity` |

---

## Favicons & PWA

```html
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#d4af37" />
```

Server serves `/favicon.ico` → `/favicon-32.png` for Chrome tab icon.

---

## Share Button

All 9 public sub-pages have a share button in the top-right of the nav:

```js
async function sharePage() {
  if (navigator.share) {
    await navigator.share({ title: document.title, url: location.href });
  } else {
    await navigator.clipboard.writeText(location.href);
    // shows inline toast "คัดลอกลิงก์แล้ว ✓"
  }
}
```

---

## Page Inventory

| Page | Path | Accent | Notes |
|---|---|---|---|
| Home | `/` | Red | Landing, product cards, eco grid, admin passcode modal |
| PPVP | `/products/ppvp.html` | Indigo | PAMM product, STP Backup card |
| HQ Ultimate | `/products/hq-ultimate.html` | Gold | PAMM product, STP Backup card |
| Golden Boy | `/products/golden-boy.html` | Green | Gold strategy, STP Backup card |
| STP Coin | `/ecosystem/stp-coin.html` | Amber | Tokenomics, roadmap |
| Free Education | `/ecosystem/free-education.html` | Sky blue | YouTube Shorts embed, registration steps |
| Valhalla Dungeon | `/ecosystem/trade-challenge.html` | Gold + Crimson | Norse theme, SS2 prizes, rebirth rules |
| Charity Project | `/ecosystem/charity-project.html` | Blue + Gold | Event photos, feature grid |
| Unlock Your Wealth | `/events/unlock-your-wealth.html` | Gold | Event page |
| SBC | `/events/sbc.html` | Gold | Event page, MP4 video embed |
| Reviews | `/reviews` | Gold | Public submit + display, 5-star, image upload |

---

## File Conventions

- All pages: single `.html` file, inline `<style>` and `<script>`
- Dark mode only — no light mode toggle
- Thai language (`lang="th"`)
- Body gets `padding-top: var(--nav-h)` because nav is `position: fixed`
- Max-width wrapper via `.page { max-width: 480–560px; margin: 0 auto; padding: 0 16px; }`

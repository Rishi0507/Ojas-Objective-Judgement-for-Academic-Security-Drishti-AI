# DrishtiAI Design System

## Typography Hierarchy

### Font Families

```css
--font-figtree: 'Figtree', system-ui, sans-serif;
--font-garamond: 'EB Garamond', Georgia, serif;
--font-mono: 'JetBrains Mono', monospace;
```

### Usage Rules

**Figtree (Primary)**
- All body text (14-16px)
- UI labels and buttons
- Data tables and lists
- Navigation items
- Form inputs

**EB Garamond (Accent)**
- Brand name "Drishti"
- Feature section headlines
- Decorative elements only
- Never more than 20% of visible text

**JetBrains Mono (Technical)**
- Timestamps (HH:MM:SS)
- Metric values (0.92, 78%)
- IDs (V001, E003, Track-07)
- Coordinates [x, y, w, h]
- File sizes and counts

### Scale

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| Hero Display | 7xl (72px) | Bold | 1 |
| Page Headline | 4xl (36px) | Bold | 1.1 |
| Section Title | lg (18px) | Semibold | 1.5 |
| Body Text | base (16px) | Regular | 1.6 |
| Small Text | sm (14px) | Regular | 1.5 |
| Tiny Text | xs (12px) | Regular | 1.4 |
| Code/Data | mono sm-xs | Medium | 1.4 |

## Color Palette

### Semantic Colors

```css
/* Primary - Blue (Trust, Clarity) */
--primary: hsl(217.2 91.2% 59.8%);
--primary-foreground: hsl(222.2 47.4% 11.2%);

/* Background - Deep Navy */
--background: hsl(224 71.4% 4.1%);
--foreground: hsl(210 20% 98%);

/* Secondary - Muted Blue-Gray */
--secondary: hsl(217.2 32.6% 17.5%);
--secondary-foreground: hsl(210 40% 98%);

/* Muted - Reduced Emphasis */
--muted: hsl(217.2 32.6% 17.5%);
--muted-foreground: hsl(215 20.2% 65.1%);

/* Border - Subtle Separation */
--border: hsl(240 3.7% 15.9%);

/* Success - Emerald (Positive) */
--success: hsl(142.1 76.2% 36.3%);

/* Warning - Amber (Caution) */
--warning: hsl(38 92% 50%);

/* Danger - Rose (Alert) */
--danger: hsl(0 84.2% 60.2%);
```

### Gradient Combinations

```css
/* Hero Gradient */
from-primary via-purple-400 to-pink-400

/* Card Gradients */
from-blue-500 to-cyan-500      /* Stats */
from-emerald-500 to-teal-500   /* Success */
from-amber-500 to-orange-500   /* Warning */
from-violet-500 to-purple-500  /* Special */
from-rose-500 to-pink-500      /* Danger */
```

### Opacity Levels

| Use Case | Opacity | Example |
|----------|---------|---------|
| Glass Surface | 2-5% | `bg-white/[0.02]` |
| Glass Strong | 5-8% | `bg-white/[0.05]` |
| Hover State | +3% | `hover:bg-white/[0.06]` |
| Active State | +5% | `bg-white/[0.08]` |
| Disabled | 40% | `text-muted-foreground/40` |
| Overlay | 60-80% | `bg-black/60` |

## Spacing Scale

Uses Tailwind's 4px base unit:

```
0.5 = 2px   (hairline)
1   = 4px   (tight)
2   = 8px   (compact)
3   = 12px  (cozy)
4   = 16px  (comfortable)
6   = 24px  (spacious)
8   = 32px  (loose)
12  = 48px  (section gap)
16  = 64px  (major sections)
```

### Component Spacing

| Component | Padding | Gap | Margin |
|-----------|---------|-----|--------|
| Button | px-4 py-2.5 | - | - |
| Card | p-6 | - | - |
| Card Grid | - | gap-4/6 | - |
| Section | - | space-y-6/8 | mb-8 |
| Form Input | px-4 py-2.5 | - | - |
| Icon + Text | - | gap-2 | - |

## Border Radius

```css
--radius-sm: 0.375rem;  /* 6px - small elements */
--radius-md: 0.5rem;    /* 8px - buttons, inputs */
--radius-lg: 0.75rem;   /* 12px - cards, modals */
--radius-xl: 1rem;      /* 16px - major sections */
--radius-2xl: 1.5rem;   /* 24px - hero elements */
--radius-full: 9999px;  /* pills, avatars */
```

## Shadows

```css
/* Subtle depth */
shadow-sm: 0 1px 2px rgba(0,0,0,0.05);

/* Standard elevation */
shadow: 0 1px 3px rgba(0,0,0,0.1);

/* Prominent */
shadow-lg: 0 10px 15px rgba(0,0,0,0.1);

/* Dramatic (modals) */
shadow-2xl: 0 25px 50px rgba(0,0,0,0.25);

/* Colored shadows */
shadow-primary/20: primary color at 20% opacity;
```

## Glass Morphism

Two levels of transparency:

### Glass (Subtle)
```css
.glass {
  @apply bg-white/[0.02] backdrop-blur-2xl border border-white/[0.08];
}
```
Use for: Background cards, secondary surfaces

### Glass Strong
```css
.glass-strong {
  @apply bg-white/[0.05] backdrop-blur-xl border border-white/[0.12];
}
```
Use for: Interactive elements, prominent cards, nested surfaces

## Animation Tokens

### Durations

```css
--duration-fast: 150ms;     /* micro-interactions */
--duration-base: 300ms;     /* standard transitions */
--duration-slow: 500ms;     /* page transitions */
--duration-slower: 800ms;   /* dramatic reveals */
```

### Easing

```css
--ease-default: cubic-bezier(0.25, 0.1, 0.25, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

### Framer Motion Patterns

**Entry Animation**
```tsx
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
```

**Staggered Children**
```tsx
transition={{ delay: i * 0.08 }}
```

**Hover Scale**
```tsx
whileHover={{ scale: 1.05 }}
whileTap={{ scale: 0.95 }}
```

**Layout Animation**
```tsx
<motion.div layoutId="uniqueId" />
```

## Component Patterns

### Button Variants

**Primary** - Main actions
```tsx
className="px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
```

**Secondary** - Less emphasis
```tsx
className="px-4 py-2.5 glass-strong hover:bg-white/[0.06] rounded-lg"
```

**Ghost** - Minimal
```tsx
className="px-4 py-2.5 hover:bg-muted/50 rounded-lg"
```

### Card Variants

**Default Card**
```tsx
className="glass rounded-xl p-6"
```

**Interactive Card**
```tsx
className="glass-strong rounded-xl p-4 hover:bg-white/[0.06] transition-all cursor-pointer"
```

**Highlight Card**
```tsx
className="glass rounded-xl p-6 border-primary/30 bg-primary/5"
```

### Status Badges

**Success**
```tsx
className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-xs rounded-full border border-emerald-500/20"
```

**Warning**
```tsx
className="px-2.5 py-1 bg-amber-500/10 text-amber-400 text-xs rounded-full border border-amber-500/20"
```

**Danger**
```tsx
className="px-2.5 py-1 bg-rose-500/10 text-rose-400 text-xs rounded-full border border-rose-500/20"
```

## Icon Usage

### Stroke Width

```tsx
<Icon strokeWidth={2} />     // Default for most icons
<Icon strokeWidth={2.5} />   // Brand icons (Eye logo)
<Icon strokeWidth={1.5} />   // Large decorative icons
```

### Sizes

```tsx
w-4 h-4  // 16px - inline with text
w-5 h-5  // 20px - buttons, small UI
w-6 h-6  // 24px - standard UI icons
w-8 h-8  // 32px - feature icons
w-20 h-20 // 80px - hero decorative
```

## Responsive Breakpoints

```css
sm: 640px   /* Mobile landscape */
md: 768px   /* Tablet portrait */
lg: 1024px  /* Tablet landscape / Small laptop */
xl: 1280px  /* Desktop */
2xl: 1536px /* Large desktop */
```

### Grid Patterns

**Stats Cards**
```tsx
className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
```

**Content + Sidebar**
```tsx
className="grid grid-cols-1 lg:grid-cols-3 gap-6"
// Then: className="lg:col-span-2"
```

## Accessibility

### Focus States
All interactive elements must have visible focus:
```css
focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background
```

### Color Contrast
Minimum ratios (WCAG AA):
- Body text: 4.5:1
- Large text (18px+): 3:1
- UI components: 3:1

### Motion Preferences
Respect user preferences:
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Best Practices

### Do's ✅

- Use Figtree for 80%+ of text
- Use monospace for technical data
- Use glass surfaces for depth
- Animate layout changes smoothly
- Provide hover feedback on interactive elements
- Use semantic color meanings consistently
- Group related content with spacing

### Don'ts ❌

- Don't use Garamond for body text
- Don't mix multiple accent fonts
- Don't use pure white backgrounds
- Don't animate without purpose
- Don't use color alone to convey meaning
- Don't exceed 3 levels of nesting
- Don't use inconsistent spacing

---

**Maintained by**: Person B, DrishtiAI Hackathon  
**Last Updated**: Created for PS2 submission

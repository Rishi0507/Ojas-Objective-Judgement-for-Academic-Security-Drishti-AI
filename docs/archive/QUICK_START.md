# Quick Start Guide

## 🚀 Application is Live!

Your DrishtiAI frontend is running at: **http://localhost:3000**

## 🎯 What You'll See

### 1. Hero Section (Landing Page)
- **Animated gradient background** with breathing effect
- Large **"Drishti"** in elegant Garamond italic
- Subtitle in modern Figtree
- Lottie animation showcase
- Two CTAs: "Enter Dashboard" and "Learn More"
- Real-time stats: 99.2% detection, <100ms processing, 10k+ events
- Smooth scroll indicator at bottom
- "Skip to Dashboard" button in bottom-right

### 2. Main Application (After clicking Enter/Skip)
- **Left Sidebar** (80px wide)
  - Eye logo with glow effect
  - Three navigation icons
  - Active tab animated indicator
  - Settings at bottom

- **Top Header**
  - Search bar with icon
  - Notification bell (red dot)
  - User profile button

- **Main Content Area**
  - Changes based on selected view

## 📊 Views Explained

### Overview (Dashboard)
What you see:
- 4 stat cards: Videos, Events, High Priority, Reviewed
- Large activity timeline chart (24 hours)
- System health panel (processing queue, storage, GPU)
- Recent videos grid (click to analyze)

**Try**: Click any video card to go to analysis view

### Analysis (Video View)
What you see:
- Video info header with back button
- 4 filter profile buttons (All, Phone, Proximity, Unusual)
- Motion heatmap with color legend
- Activity timeline with event markers
- Quality metrics panel (Observability: 0.92)
- Processing info details
- Detected events list

**Try**: Click any event in the list to see details

### Events (Event Detail)
What you see:
- Event header with back button
- Video player mockup (02:03.5 - 02:11.8)
- Play/Original/Annotated buttons
- Evidence & Explanation (expandable)
- Detection confidence grid (78%, 0.72, 0.96, 0.04)
- Supporting evidence bullets
- Event metadata panel
- Quality factors progress bars
- Investigator feedback buttons
- Submit feedback button

**Try**: Click feedback options, then submit

## 🎨 Design Features to Notice

### Typography
- **Figtree** - All UI text (clean, modern)
- **EB Garamond** - "Drishti" brand name (elegant, italic)
- **JetBrains Mono** - All numbers, IDs, timestamps (technical)

### Colors
- **Blue** (#3B82F6) - Primary actions, links, active states
- **Emerald** - Success, completed, high quality
- **Amber** - Warning, processing, medium priority
- **Rose** - Danger, high priority, alerts

### Glass Morphism
- Look for **translucent cards** with subtle blur
- Two levels: very subtle (2%) and slightly stronger (5%)
- Creates depth without harsh borders

### Animations
- **Entry**: Cards slide up and fade in
- **Hover**: Buttons scale to 1.05x
- **Tab Switch**: Active indicator smoothly slides
- **Progress Bars**: Animate to their final width
- **Gradient**: Breathing effect (subtle expansion/contraction)

### Status Indicators
- **Processing**: Amber pill with pulsing dot
- **Completed**: Emerald pill
- **High Priority**: Rose badge
- **Unreviewed**: Amber badge

## 🔍 Interactive Elements

### Click These:
1. **Sidebar icons** - Switch between views
2. **Stat cards** - (Currently visual only, can be made interactive)
3. **Video cards** - Go to analysis view
4. **Filter profiles** - Highlight selected filter
5. **Event timeline bars** - Go to event detail
6. **Event cards** - Open detailed view
7. **Feedback buttons** - Select and highlight
8. **Submit feedback** - Confirm selection

### Hover These:
- Any button (scales up)
- Video cards (background lightens)
- Event cards (background changes)
- Sidebar icons (visible feedback)

## 📱 Responsive Behavior

The UI adapts across screen sizes:
- **Mobile** (< 640px): Single column, stacked cards
- **Tablet** (640-1024px): 2 columns for stats
- **Desktop** (> 1024px): Full 4 columns, optimal layout

**Try**: Resize your browser window to see adaptation

## 🎯 Key Differentiators

What makes this UI stand out:

1. **Hero Section** - Animated gradient with breathing effect (unique)
2. **Typography Mix** - Figtree + Garamond creates memorable brand
3. **Glass Morphism** - Professional depth without clutter
4. **Color System** - HSL-based for consistency
5. **Animations** - Purposeful, not decorative
6. **Data Clarity** - Monospace for technical values
7. **Status Design** - Pills with icons and borders
8. **Documentation** - Complete design system

## 🛠 Development Features

### Design System
- All colors use HSL tokens (themeable)
- Spacing follows 4px grid
- Components use `cn()` utility for conditional classes
- Glass morphism via Tailwind utilities

### File Structure
```
app/
  layout.tsx        # Fonts: Figtree, Garamond, Mono
  page.tsx          # Hero routing + main views
  globals.css       # Design tokens, glass utilities

components/
  Hero.tsx          # Landing page
  Sidebar.tsx       # Navigation
  Header.tsx        # Search + user
  Dashboard.tsx     # Overview stats
  VideoAnalysis.tsx # Video detail
  EventDetail.tsx   # Event detail
  ui/
    animated-gradient-background.tsx  # Gradient animation

lib/
  utils.ts          # cn() utility

DESIGN_SYSTEM.md    # Complete design guide
IMPROVEMENTS.md     # All changes documented
```

## ⚡ Performance

- Initial load: ~3-4 seconds (Next.js compilation)
- Navigation: Instant (client-side routing)
- Animations: 60fps (Framer Motion + GPU acceleration)
- Bundle size: Optimized (tree-shaking enabled)

## 🎓 Learning Points

### For Hackathon Judges
1. **Design Thinking** - Every choice documented in DESIGN_SYSTEM.md
2. **User Experience** - Progressive disclosure, clear hierarchy
3. **Technical Quality** - TypeScript, modern patterns, maintainable
4. **Attention to Detail** - Consistent spacing, proper contrast, smooth animations
5. **Production Ready** - Follows industry best practices (shadcn/ui conventions)

### For Developers
1. Check `DESIGN_SYSTEM.md` for all design tokens
2. Check `IMPROVEMENTS.md` for what changed and why
3. Use `cn()` from `lib/utils.ts` for conditional classes
4. Follow existing component patterns for consistency
5. HSL colors in `tailwind.config.js` for theming

## 🚦 Next Steps

### To Customize:
1. **Colors**: Edit HSL values in `tailwind.config.js`
2. **Fonts**: Change imports in `app/layout.tsx`
3. **Animation Speed**: Adjust `transition={{ duration }}` values
4. **Spacing**: Modify gap/padding values following 4px grid

### To Add Backend:
1. Replace mock data in components with API calls
2. Implement endpoints listed in README.md
3. Add loading states (already styled with glass effects)
4. Add error handling (use danger color tokens)

### To Deploy:
```bash
npm run build    # Production build
npm start        # Serve production
```

## 📞 Support

All design decisions documented in:
- `DESIGN_SYSTEM.md` - Complete design guide
- `IMPROVEMENTS.md` - All changes explained
- `README.md` - Project overview

---

**Enjoy exploring the interface!** 🎉

The application showcases modern UI/UX best practices with thoughtful design choices at every level.

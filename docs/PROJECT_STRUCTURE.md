# DrishtiAI Project Structure & Architecture

> **For LLMs/Developers**: This document provides complete context for understanding and modifying the codebase without needing to read every file.

## 📁 Project Overview

**Type**: Next.js 14 (App Router) + TypeScript + Tailwind CSS  
**Purpose**: Frontend for PS2 DrishtiAI Hackathon - Offline Video Analytics System  
**Design**: Clean, professional, neutral theme (light mode with grays)

## 🗂 Folder Structure

```
drishti-video-analytics/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout, font imports, metadata
│   ├── page.tsx                 # Main entry point, routing logic
│   └── globals.css              # Global styles, Tailwind directives, utilities
│
├── components/                   # React components
│   ├── Hero.tsx                 # Landing page hero section
│   ├── Sidebar.tsx              # Navigation sidebar (left)
│   ├── Header.tsx               # Top header with search & user
│   ├── Dashboard.tsx            # Main dashboard view
│   ├── VideoAnalysis.tsx        # Video analysis view
│   ├── EventDetail.tsx          # Event detail view
│   └── ui/                      # Reusable UI components
│       └── animated-gradient-background.tsx
│
├── lib/                         # Utility functions
│   └── utils.ts                 # Helper functions (cn for classnames)
│
├── public/                      # Static assets (if any)
│
├── tailwind.config.js           # Tailwind configuration, theme
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Dependencies
├── next.config.js               # Next.js configuration
├── postcss.config.js            # PostCSS configuration
├── README.md                    # User-facing documentation
└── PROJECT_STRUCTURE.md         # This file

```

## 🎨 Design System

### Color Palette
```typescript
// Neutral, professional theme
background: "hsl(0 0% 97%)"           // Soft white background
card: "hsl(0 0% 100%)"                // Pure white cards
foreground: "hsl(215 25% 27%)"        // Dark blue-gray text
primary: "hsl(215 25% 27%)"           // Primary action color
muted: "hsl(215 16% 47%)"             // Secondary text
border: "hsl(0 0% 89%)"               // Light gray borders
```

### Typography
```typescript
font-sans: 'Figtree'         // Primary UI font (80% of text)
font-serif: 'EB Garamond'    // Accent font (brand, headers)
font-mono: 'JetBrains Mono'  // Technical data (IDs, timestamps, metrics)
```

### Component Patterns
```css
.card                  /* White background, border, rounded */
.card-hover           /* Subtle hover effect with shadow */
hover:bg-accent       /* Light gray hover background */
```

## 📄 File Descriptions

### `app/layout.tsx`
**Purpose**: Root layout wrapper for entire app  
**Key Features**:
- Imports Google Fonts (Figtree, EB Garamond, JetBrains Mono)
- Sets metadata (title, description)
- Wraps all pages with html/body tags
- Applies font CSS variables

**When to edit**: 
- Change fonts
- Update global metadata
- Add global providers

### `app/page.tsx`
**Purpose**: Main application entry point and routing logic  
**State Management**:
```typescript
showHero: boolean              // Show hero section or main app
activeView: 'dashboard' | 'analysis' | 'event'
selectedVideo: string | null   // Currently selected video ID
selectedEvent: string | null   // Currently selected event ID
```

**Flow**:
1. Shows Hero section on first load
2. Click "Skip to Dashboard" → Shows main app
3. Dashboard → Click video → VideoAnalysis
4. VideoAnalysis → Click event → EventDetail

**When to edit**:
- Add new views/routes
- Change navigation flow
- Add global state management

### `app/globals.css`
**Purpose**: Global styles and Tailwind utilities  
**Contains**:
- Tailwind directives (@tailwind base, components, utilities)
- Custom utility classes (.card, .card-hover)
- Scrollbar styling
- Selection styling

**When to edit**:
- Add global CSS utilities
- Modify scrollbar appearance
- Change selection colors

### `components/Hero.tsx`
**Purpose**: Landing page hero section  
**Features**:
- Large title with brand name
- Feature highlights (Real-time, Privacy, Accuracy)
- CTA buttons (Launch Dashboard, View Demo)
- Lottie animation integration
- Simple animations (fade in, slide up)

**Props**: None  
**State**: None

**When to edit**:
- Change hero copy
- Update features list
- Modify CTA buttons
- Change animations

### `components/Sidebar.tsx`
**Purpose**: Left navigation sidebar  
**Props**:
```typescript
activeView: string                      // Current active view
onViewChange: (view) => void           // Callback to change view
```

**Navigation Items**:
- Dashboard (LayoutDashboard icon)
- Analysis (Video icon)
- Events (FileSearch icon)
- Settings (bottom, Settings icon)

**Features**:
- Active state indicator (left border)
- Hover effects
- Logo at top (Eye icon)

**When to edit**:
- Add/remove navigation items
- Change icons
- Modify active indicator

### `components/Header.tsx`
**Purpose**: Top header bar  
**Features**:
- Search input (left side)
- Notification bell (red dot indicator)
- User profile button (right side)

**State**: None (search functionality not implemented)

**When to edit**:
- Implement search functionality
- Add notification dropdown
- Add user menu dropdown

### `components/Dashboard.tsx`
**Purpose**: Main dashboard overview  
**Props**:
```typescript
onVideoSelect: (videoId: string) => void
```

**Sections**:
1. **Stats Cards** (4 cards)
   - Total Videos, Events Detected, High Priority, Reviewed
   - Icon, value, label, trend indicator

2. **Activity Timeline** (Recharts)
   - 24-hour area chart
   - X-axis: hours (0-23)
   - Y-axis: event count
   - Mock data: Array(24) with random values

3. **System Health** (right sidebar)
   - Processing Queue (1/8, 12.5%)
   - Storage Used (3.2 TB, 64%)
   - GPU Utilization (47%)

4. **Recent Videos** (bottom)
   - Video cards with status badges
   - Click to navigate to VideoAnalysis

**Mock Data**:
```typescript
stats = [{ label, value, icon, change }]
recentVideos = [{ id, name, duration, status, events, quality, timestamp }]
activityData = Array(24).map(hour => ({ hour, events }))
```

**When to edit**:
- Connect to real API endpoints
- Add filtering/sorting
- Modify stat calculations
- Change chart appearance

### `components/VideoAnalysis.tsx`
**Purpose**: Detailed video analysis view  
**Props**:
```typescript
videoId: string
onEventSelect: (eventId: string) => void
```

**Sections**:
1. **Header**
   - Back button
   - Video title
   - Metadata (ID, duration, event count)
   - Export button

2. **Filter Profiles** (4 buttons)
   - All Events (34)
   - Phone Activity (5)
   - Proximity (12)
   - Unusual Motion (17)
   - Active state changes styling

3. **Motion Heatmap** (left, top)
   - Placeholder for cv2.applyColorMap output
   - Legend (Low/Medium/High)
   - Aspect ratio: 16:9

4. **Activity Timeline** (left, bottom)
   - Event markers on timeline
   - Click to navigate to EventDetail
   - Color-coded by priority (red=high, yellow=medium)

5. **Quality Metrics** (right, top)
   - Observability score (0.92)
   - Camera Shake, Blur Score, Lighting, Occlusion
   - Progress bars

6. **Processing Info** (right, bottom)
   - Resolution, Frame Rate, Sampling, Frames, Time

7. **Detected Events** (bottom)
   - List of all events
   - Priority badges
   - Click to view details

**Mock Data**:
```typescript
mockEvents = [{ id, start, end, duration, motionScore, cameraShake, priority, description, trackId }]
filterProfiles = [{ id, label, count, icon }]
```

**When to edit**:
- Connect to real video data API
- Implement actual heatmap rendering
- Add sorting/filtering logic
- Connect timeline to real event data

### `components/EventDetail.tsx`
**Purpose**: Detailed event analysis and feedback  
**Props**:
```typescript
eventId: string
onBack: () => void
```

**Sections**:
1. **Header**
   - Back button
   - Event ID, Track ID
   - Review status badge

2. **Video Player** (left, top)
   - Placeholder for video playback
   - Timestamp overlay (02:03.5 - 02:11.8)
   - Play/Original/Annotated buttons

3. **Evidence & Analysis** (left, bottom)
   - Expandable section (toggle button)
   - Alert box with description
   - 4 metric cards (Detection, Motion, Observability, Shake)
   - Supporting evidence bullets
   - Warning note about human review

4. **Metadata** (right, top)
   - Video ID, Start, End, Duration, Track ID, ROI

5. **Quality Factors** (right, middle)
   - 4 progress bars (Camera Shake, Blur, Occlusion, Lighting)

6. **Investigator Feedback** (right, bottom)
   - 5 feedback options (Relevant, Normal, Wrong ROI, Wrong Object, Duplicate)
   - Submit button (disabled until selection)

**State**:
```typescript
selectedFeedback: string | null
showExplanation: boolean
```

**When to edit**:
- Implement video playback
- Connect feedback to API
- Add ROI overlay visualization
- Load real event data

### `components/ui/animated-gradient-background.tsx`
**Purpose**: Animated gradient background for hero section  
**Props**:
```typescript
startingGap?: number          // Initial gradient size
Breathing?: boolean           // Enable breathing animation
gradientColors?: string[]     // Array of colors
gradientStops?: number[]      // Stop percentages
animationSpeed?: number       // Animation speed
breathingRange?: number       // Breathing intensity
```

**Usage**: Only used in Hero.tsx

**When to edit**:
- Change gradient colors
- Adjust animation speed
- Modify breathing effect

### `lib/utils.ts`
**Purpose**: Utility functions  
**Functions**:
```typescript
cn(...inputs: ClassValue[]): string
// Merges classnames with clsx and tailwind-merge
// Usage: className={cn("base-class", condition && "conditional-class")}
```

**When to edit**:
- Add new utility functions
- Add type helpers

## 🔌 Backend Integration Points

### Expected API Endpoints

```typescript
// Videos
GET  /api/videos
Response: Array<{
  id: string
  name: string
  duration: string
  status: 'completed' | 'processing'
  events: number
  quality: number
  timestamp: string
}>

// Video Details
GET  /api/videos/:id
Response: {
  id: string
  metadata: { resolution, fps, sampling, frames, processingTime }
  qualityMetrics: { observability, cameraShake, blur, lighting, occlusion }
  heatmapUrl: string  // URL to heatmap image
  timelineData: Array<{ time: number, activity: number }>
}

// Events for Video
GET  /api/videos/:id/events
Query: ?filter=all|phone|proximity|unusual
Response: Array<{
  id: string
  start: number
  end: number
  duration: number
  motionScore: number
  cameraShake: number
  priority: 'high' | 'medium' | 'low'
  type: string
  description: string
  trackId: string
}>

// Event Detail
GET  /api/events/:id
Response: {
  id: string
  videoId: string
  start: number
  end: number
  duration: number
  trackId: string
  roi: [number, number, number, number]
  clipUrl: string           // URL to video clip
  annotatedClipUrl: string  // URL to annotated clip
  detection: { confidence: number, object: string }
  motionScore: number
  observability: number
  cameraShake: number
  qualityFactors: { shake: number, blur: number, occlusion: number, lighting: number }
  evidence: string[]
}

// Submit Feedback
POST /api/events/:id/feedback
Body: {
  feedback: 'relevant' | 'normal' | 'wrong_roi' | 'wrong_object' | 'duplicate'
}

// Search
GET  /api/search
Query: ?q=search+term
Response: Array<{ type: 'video' | 'event', id: string, name: string }>
```

## 🔧 Common Modifications

### Adding a New View
1. Create component in `components/YourView.tsx`
2. Add to `app/page.tsx` state: `activeView` type
3. Add navigation item to `components/Sidebar.tsx`
4. Add conditional render in `app/page.tsx`

### Connecting to Real API
1. Replace mock data with `fetch()` or API client
2. Add loading states (`isLoading`)
3. Add error handling (`error` state)
4. Use `useEffect` to fetch on mount
5. Consider using SWR or React Query for caching

### Changing Design Theme
1. Edit `tailwind.config.js` colors
2. Update `app/globals.css` if needed
3. Components will automatically update

### Adding New Components
1. Create in `components/YourComponent.tsx`
2. Export as default
3. Import where needed
4. Add props interface with TypeScript

## 📝 Code Conventions

### File Naming
- Components: PascalCase (`Dashboard.tsx`)
- Utilities: camelCase (`utils.ts`)
- Config: kebab-case (`tailwind.config.js`)

### Component Structure
```typescript
'use client'  // If using hooks/interactivity

import { ... }

interface ComponentProps {
  // TypeScript interface for props
}

export default function Component({ props }: ComponentProps) {
  // State
  const [state, setState] = useState()
  
  // Effects
  useEffect(() => {}, [])
  
  // Handlers
  const handleClick = () => {}
  
  // Render
  return (
    <div className="...">
      {/* JSX */}
    </div>
  )
}
```

### Styling Approach
- Tailwind utility classes (preferred)
- Custom utilities in `globals.css` (sparingly)
- No inline styles unless dynamic

### State Management
- Local state with `useState` (current)
- Consider Context API for global state
- Consider Zustand/Redux for complex state

## 🎯 Current Limitations & TODOs

### Missing Features
- [ ] Real video playback
- [ ] Actual heatmap rendering (needs cv2 output)
- [ ] ROI overlay on video
- [ ] Search functionality
- [ ] Sorting/filtering logic
- [ ] API integration
- [ ] Loading states
- [ ] Error handling
- [ ] Pagination for events
- [ ] Export functionality

### Known Issues
- All data is mocked
- No authentication
- No data persistence
- No real-time updates

## 🚀 Getting Started (For New Developers)

### Prerequisites
```bash
Node.js 18+
npm or yarn
```

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
# Open http://localhost:3000
```

### Building
```bash
npm run build
npm start
```

### Key Dependencies
```json
{
  "next": "^14.0.0",           // React framework
  "react": "^18.2.0",          // UI library
  "typescript": "^5.3.0",      // Type safety
  "tailwindcss": "^3.3.6",     // Styling
  "framer-motion": "^10.16.0", // Animations
  "recharts": "^2.10.0",       // Charts
  "lucide-react": "^0.294.0",  // Icons
  "@lottiefiles/dotlottie-react": "^0.6.0" // Lottie
}
```

## 💡 Tips for LLMs/AI Assistants

### When asked to modify Dashboard:
- Look at `components/Dashboard.tsx`
- Stats data is in `stats` array
- Videos data is in `recentVideos` array
- Chart data is in `activityData` array
- Use Recharts for any chart modifications

### When asked to modify styling:
- Check `tailwind.config.js` for theme colors
- Use existing utility classes from `globals.css`
- Follow Tailwind convention (no custom CSS unless necessary)

### When asked to add features:
- Create new component in `components/`
- Import in appropriate parent component
- Add TypeScript interface for props
- Use existing design patterns (card, card-hover, etc.)

### When asked to connect to API:
- Replace mock data arrays with `fetch()` calls
- Add loading state (`isLoading`)
- Add error state (`error`)
- Use `useEffect` for data fetching
- Consider using SWR or React Query

### When asked about colors:
- Background: Light gray (`hsl(0 0% 97%)`)
- Cards: White (`hsl(0 0% 100%)`)
- Primary: Dark blue-gray (`hsl(215 25% 27%)`)
- No neon, no glows, keep it professional

---

**Last Updated**: Project creation  
**Maintained by**: DrishtiAI Hackathon Team

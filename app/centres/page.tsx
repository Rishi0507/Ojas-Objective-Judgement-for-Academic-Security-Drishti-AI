import FleetCalibration from '@/components/FleetCalibration'

/**
 * Direct URL for the fleet view. The same component is also reachable as a
 * sidebar tab inside the main shell; this route keeps it linkable on its own,
 * which is what an operator monitoring centres actually wants open.
 */
export default function CentresPage() {
  return <FleetCalibration />
}

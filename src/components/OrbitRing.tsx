import { Line } from '@react-three/drei'
import { useMemo } from 'react'

export function OrbitRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    return Array.from({ length: 97 }, (_, index) => {
      const angle = (index / 96) * Math.PI * 2
      return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as [number, number, number]
    })
  }, [radius])

  return <Line points={points} color="#526083" transparent opacity={0.32} lineWidth={0.7} />
}

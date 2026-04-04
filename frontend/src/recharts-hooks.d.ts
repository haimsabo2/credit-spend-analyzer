/**
 * Recharts exposes useXAxis / useYAxis from lib/hooks at runtime but not in package typings.
 */
declare module "recharts/lib/hooks.js" {
  type CategoryScale = {
    map: (value: unknown, options?: { position?: string }) => number | undefined
  }
  type ValueScale = {
    map: (value: number) => number | undefined
  }
  export function useXAxis(index?: number): { scale?: CategoryScale } | undefined
  export function useYAxis(index?: number): { scale?: ValueScale } | undefined
}

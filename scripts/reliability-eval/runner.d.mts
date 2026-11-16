export interface ReliabilityArgs {
  help?: boolean
  mode: "offline" | "replay" | "live"
  replay?: string
  maxRequests?: string
  out?: string
  cases?: string
  baseline?: string
}
export function parseReliabilityArgs(args: string[]): ReliabilityArgs

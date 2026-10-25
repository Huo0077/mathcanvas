export interface SolidEvalArgs { help?: boolean; allowPaid?: boolean; suite?: string; maxRequests?: string; timeoutMs?: string; maxTokens?: string; replay?: string }
export function parseSolidEvalArgs(args: string[]): SolidEvalArgs

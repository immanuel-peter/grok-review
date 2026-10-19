import type { StructuredFileComment } from "@/lib/structured-review";

export type Severity = StructuredFileComment["severity"];

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-[#ff8a8f]",
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-subtle",
};

export function GrokMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-ink"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.57} height={size * 0.57} viewBox="0 0 20 20" fill="none" stroke="#0a0a0a" strokeWidth="2.2" aria-hidden="true">
        <circle cx="10" cy="10" r="7" />
        <path d="M6.5 13.5l7-7" />
      </svg>
    </span>
  );
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg className={`chevron shrink-0 transition-transform duration-100 ${className}`} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  );
}

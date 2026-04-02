interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
}

export function Logo({ className = "", size = 32, showText = true }: LogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-label="GetOTPs logo"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Message bubble base */}
        <rect x="2" y="4" width="22" height="16" rx="4" fill="hsl(185 72% 38%)" />
        {/* Bubble tail */}
        <path d="M8 20 L6 26 L14 22" fill="hsl(185 72% 38%)" />
        {/* OTP dots inside bubble */}
        <circle cx="8" cy="12" r="2" fill="white" />
        <circle cx="13" cy="12" r="2" fill="white" />
        <circle cx="18" cy="12" r="2" fill="white" />
        {/* Shield/check overlay */}
        <circle cx="24" cy="22" r="7" fill="hsl(222 47% 11%)" />
        <circle cx="24" cy="22" r="6" fill="hsl(185 72% 38%)" />
        {/* Checkmark */}
        <path d="M21 22 L23 24 L27 20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showText && (
        <span className="font-bold text-xl tracking-tight text-foreground">
          Get<span className="text-primary">OTPs</span>
        </span>
      )}
    </div>
  );
}

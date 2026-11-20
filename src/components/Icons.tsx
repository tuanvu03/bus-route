import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) =>
  base(p, <path d="M6.5 4.2v11.6l9-5.8-9-5.8Z" fill="currentColor" stroke="none" />);

export const PauseIcon = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="5.4" y="4" width="3.4" height="12" rx="1" fill="currentColor" stroke="none" />
      <rect x="11.2" y="4" width="3.4" height="12" rx="1" fill="currentColor" stroke="none" />
    </>,
  );

export const ResetIcon = (p: IconProps) =>
  base(p, <path d="M4 9a6 6 0 1 1 1.7 4.1M4 4v5h5" />);

export const ArrowRightIcon = (p: IconProps) =>
  base(p, <path d="M4 10h12m-4.5-4.5L16 10l-4.5 4.5" />);

export const ArrowLeftIcon = (p: IconProps) =>
  base(p, <path d="M16 10H4m4.5-4.5L4 10l4.5 4.5" />);

export const ChevronLeftIcon = (p: IconProps) =>
  base(p, <path d="M12.5 4.5 7 10l5.5 5.5" />);

export const ChevronRightIcon = (p: IconProps) =>
  base(p, <path d="M7.5 4.5 13 10l-5.5 5.5" />);

export const SearchIcon = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="9" cy="9" r="5.2" />
      <path d="m13 13 3.4 3.4" />
    </>,
  );

export const PlusIcon = (p: IconProps) => base(p, <path d="M10 4v12M4 10h12" />);
export const MinusIcon = (p: IconProps) => base(p, <path d="M4 10h12" />);
export const CloseIcon = (p: IconProps) => base(p, <path d="m5 5 10 10M15 5 5 15" />);

export const BusIcon = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="3.4" y="3.6" width="13.2" height="11.2" rx="2.2" />
      <path d="M6.2 15v2m7.6-2v2M3.4 10.2h13.2" />
      <circle cx="6.7" cy="12.4" r=".7" fill="currentColor" stroke="none" />
      <circle cx="13.3" cy="12.4" r=".7" fill="currentColor" stroke="none" />
    </>,
  );

export const FlagIcon = (p: IconProps) =>
  base(p, <path d="M5 17V3.5h8.5l-1.8 3.4 1.8 3.4H5" />);

export const StationIcon = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="4" y="3.5" width="12" height="10" rx="2.4" />
      <path d="M4 12.5h12M7 17l2-2m4 2-2-2" />
      <circle cx="7.2" cy="8" r=".7" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r=".7" fill="currentColor" stroke="none" />
    </>,
  );

export const RouteIcon = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="4.5" cy="15.5" r="2" />
      <circle cx="15.5" cy="4.5" r="2" />
      <path d="M6.5 15.5h4a2 2 0 0 0 2-2v-7" strokeDasharray="2.5 2.5" />
    </>,
  );

export const LayersIcon = (p: IconProps) =>
  base(p, <path d="m10 3 7 4-7 4-7-4 7-4Zm-7 7.5 7 4 7-4M3 14l7 4 7-4" />);

export const TargetIcon = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="10" cy="10" r="6.4" />
      <circle cx="10" cy="10" r="2" />
    </>,
  );

export const CheckIcon = (p: IconProps) => base(p, <path d="m4.5 10.2 3.6 3.6 7.4-8" />);

export const SparkIcon = (p: IconProps) =>
  base(
    p,
    <path d="M10 2.5c.5 4 1.7 5.2 5.7 5.7-4 .5-5.2 1.7-5.7 5.7-.5-4-1.7-5.2-5.7-5.7 4-.5 5.2-1.7 5.7-5.7ZM15.5 13.5c.2 1.5.7 2 2.2 2.2-1.5.2-2 .7-2.2 2.2-.2-1.5-.7-2-2.2-2.2 1.5-.2 2-.7 2.2-2.2Z" />,
  );

export const SortIcon = (p: IconProps) =>
  base(p, <path d="M5 4v12m0 0-2.5-2.5M5 16l2.5-2.5M15 16V4m0 0 2.5 2.5M15 4l-2.5 2.5" />);

export const InfoIcon = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5M10 6.2v.2" />
    </>,
  );

export const WarningIcon = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M10 3 18 16.5H2L10 3Z" />
      <path d="M10 8v4M10 14.3v.2" />
    </>,
  );

export const ClockIcon = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.2l2.8 1.8" />
    </>,
  );

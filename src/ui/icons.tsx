// Authored 20px line icons. No icon library is installed (A owns dependencies).
type P = { size?: number; className?: string };

const paths = {
  alert: <><path d="M10 3.2 17.6 16.4H2.4L10 3.2Z" /><path d="M10 8.2v3.6" /><path d="M10 14.2v.1" /></>,
  question: <><circle cx="10" cy="10" r="7.2" /><path d="M7.9 7.9a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.9-1.1 1.7" /><path d="M10 14.1v.1" /></>,
  phoneOff: <><path d="M5.2 3.6h2.4l1.2 3-1.6 1.1a8.4 8.4 0 0 0 1.4 2" /><path d="M11.6 12.2a8.4 8.4 0 0 0 .6.4l1.1-1.6 3 1.2v2.4a1.6 1.6 0 0 1-1.7 1.6A12.4 12.4 0 0 1 3.6 5.3a1.6 1.6 0 0 1 1.6-1.7" /><path d="M3 3l14 14" /></>,
  phone: <path d="M5.2 3.6h2.4l1.2 3-1.6 1.1a8.4 8.4 0 0 0 4.1 4.1l1.1-1.6 3 1.2v2.4a1.6 1.6 0 0 1-1.7 1.6A12.4 12.4 0 0 1 3.6 5.3a1.6 1.6 0 0 1 1.6-1.7Z" />,
  check: <path d="m4.4 10.4 3.4 3.4 7.8-7.8" />,
  checkCircle: <><circle cx="10" cy="10" r="7.2" /><path d="m6.8 10.2 2.2 2.2 4.4-4.6" /></>,
  eye: <><path d="M2.4 10S5.2 4.8 10 4.8s7.6 5.2 7.6 5.2-2.8 5.2-7.6 5.2S2.4 10 2.4 10Z" /><circle cx="10" cy="10" r="2.2" /></>,
  clock: <><circle cx="10" cy="10" r="7.2" /><path d="M10 6v4l2.6 1.6" /></>,
  message: <path d="M5.4 3.6h9.2a2 2 0 0 1 2 2v6.2a2 2 0 0 1-2 2H8.2l-3.6 2.8v-2.8a2 2 0 0 1-1.2-1.8V5.6a2 2 0 0 1 2-2Z" />,
  truck: <><path d="M2.6 5.4h9v7.8h-9z" /><path d="M11.6 8.2h3.2l2.6 2.6v2.4h-5.8" /><circle cx="5.6" cy="14.4" r="1.5" /><circle cx="14.2" cy="14.4" r="1.5" /></>,
  battery: <><rect x="2.6" y="6" width="13" height="8" rx="1.6" /><path d="M17.4 8.6v2.8" /><path d="M5.4 8.8v2.4M8 8.8v2.4" /></>,
  search: <><circle cx="8.8" cy="8.8" r="5.2" /><path d="m12.6 12.6 4 4" /></>,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  route: <><circle cx="5" cy="15" r="1.8" /><circle cx="15" cy="5" r="1.8" /><path d="M6.8 15h5.4a2.6 2.6 0 0 0 0-5.2H7.8a2.6 2.6 0 0 1 0-5.2h5.4" /></>,
  board: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></>,
  form: <><rect x="4" y="2.8" width="12" height="14.4" rx="1.6" /><path d="M7 7h6M7 10h6M7 13h3.4" /></>,
  mobile: <><rect x="5.4" y="2.4" width="9.2" height="15.2" rx="2" /><path d="M9 15h2" /></>,
  reset: <><path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.5" /><path d="M3.4 3.4v3.4h3.4" /></>,
  bolt: <path d="M11 2.6 4.6 11h4.6L8.6 17.4 15.4 9h-4.6L11 2.6Z" />,
  send: <path d="M3 10 17 3.4 13.2 17l-3-5.4L3 10Zm7.2 1.6L17 3.4" />,
  chevron: <path d="m7.6 5 5 5-5 5" />,
  person: <><circle cx="10" cy="6.8" r="3" /><path d="M4.2 16.6a5.8 5.8 0 0 1 11.6 0" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, className }: P & { name: IconName }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

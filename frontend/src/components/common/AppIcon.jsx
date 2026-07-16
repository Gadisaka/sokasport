import {
  Banknote,
  Bell,
  Bird,
  Clipboard,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleDot,
  Copy,
  Dribbble,
  Flag,
  Gamepad2,
  Gift,
  Globe,
  Hash,
  Home,
  LayoutGrid,
  Menu,
  MessageCircle,
  Minus,
  Plus,
  Radio,
  Search,
  Send,
  Table,
  Ticket,
  Trash2,
  Trophy,
  Tv,
  UserRound,
  Volleyball,
  Wallet,
  X,
  Rocket,
} from "lucide-react";

const ICONS = {
  banknote: Banknote,
  bell: Bell,
  bird: Bird,
  clipboard: Clipboard,
  check: Check,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  circle: Circle,
  circleDot: CircleDot,
  copy: Copy,
  dribbble: Dribbble,
  flag: Flag,
  gamepad: Gamepad2,
  gift: Gift,
  globe: Globe,
  grid: LayoutGrid,
  hash: Hash,
  home: Home,
  menu: Menu,
  messageCircle: MessageCircle,
  minus: Minus,
  plus: Plus,
  radio: Radio,
  search: Search,
  send: Send,
  table: Table,
  ticket: Ticket,
  trash: Trash2,
  trophy: Trophy,
  tv: Tv,
  user: UserRound,
  volleyball: Volleyball,
  wallet: Wallet,
  x: X,
  rocket: Rocket,

  // locate-fixed : LocateFixed,
  // volleyball: Volleyball,
};

function AppIcon({
  name = "circle",
  className = "",
  size = 16,
  strokeWidth = 2,
}) {
  const Icon = ICONS[name] ?? Circle;
  return (
    <Icon
      className={`inline-block align-middle ${className}`.trim()}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}

export default AppIcon;

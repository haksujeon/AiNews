import {
  BrainCircuit,
  Cpu,
  TrendingUp,
  Landmark,
  BarChart3,
  Users,
  Palette,
  Rocket,
  Newspaper,
} from "lucide-react";
import { getCategoryStyle } from "@/lib/news-utils";

const ICON_MAP: Record<string, React.ElementType> = {
  BrainCircuit,
  Cpu,
  TrendingUp,
  Landmark,
  BarChart3,
  Users,
  Palette,
  Rocket,
  Newspaper,
};

export function NewsPlaceholder({
  category,
  className = "h-48",
}: {
  category: string | null;
  className?: string;
}) {
  const style = getCategoryStyle(category);
  const Icon = ICON_MAP[style.icon] ?? Newspaper;

  return (
    <div
      className={`${className} bg-gradient-to-br ${style.gradient} flex items-center justify-center relative overflow-hidden`}
    >
      <div className="absolute inset-0 opacity-10">
        <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/20" />
        <div className="absolute -left-4 -bottom-4 w-24 h-24 rounded-full bg-white/10" />
      </div>
      <Icon className="w-12 h-12 text-white/80" />
    </div>
  );
}

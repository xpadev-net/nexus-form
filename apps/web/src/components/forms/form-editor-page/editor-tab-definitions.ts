import {
  Inbox,
  type LucideIcon,
  MessageSquare,
  Settings,
  Share2,
  ShieldCheck,
} from "lucide-react";
import type { EditorTab } from "@/components/forms/form-editor-tabs";

export const EDITOR_TAB_DEFINITIONS: {
  key: EditorTab;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "editor", label: "エディタ", icon: MessageSquare },
  { key: "settings", label: "設定", icon: Settings },
  { key: "validation", label: "検証", icon: ShieldCheck },
  { key: "sharing", label: "共有", icon: Share2 },
  { key: "responses", label: "回答", icon: Inbox },
];

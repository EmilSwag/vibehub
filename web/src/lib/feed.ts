import type { Friend, Presence } from "../types";
import type { AchievementId } from "./achievements";

export type FeedEventType = "session" | "achievement" | "project" | "level";

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  user: {
    username: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  timestamp: string;
  badgeId?: AchievementId;
  content: {
    title: string;
    description: string;
    meta?: string;
    projectSlug?: string;
  };
  reactions: {
    respect: number;
    flame: number;
    userReactedRespect?: boolean;
    userReactedFlame?: boolean;
  };
}

export function generateFeedEvents(
  friends: Friend[],
  presences: Map<string, Presence>,
  currentUser?: { username: string; displayName: string; avatarUrl?: string | null } | null
): FeedEvent[] {
  const events: FeedEvent[] = [];

  // 1. Current user milestone / event
  if (currentUser) {
    events.push({
      id: "feed-user-achieve",
      type: "achievement",
      user: currentUser,
      timestamp: "12m ago",
      badgeId: "token-millionaire",
      content: {
        title: "UNLOCKED: TOKEN MILLIONAIRE",
        description: "Surpassed 1,000,000 AI tokens burned with active coding pairs.",
        meta: "2,701,016,556 total tokens",
      },
      reactions: { respect: 8, flame: 14, userReactedFlame: true },
    });
  }

  // 2. Active friends live pairing sessions
  for (const f of friends) {
    const p = presences.get(f.user.username);
    if (p && p.status === "active" && p.activity) {
      events.push({
        id: `feed-session-${f.user.username}`,
        type: "session",
        user: {
          username: f.user.username,
          displayName: f.user.displayName,
          avatarUrl: f.user.avatarUrl,
        },
        timestamp: "Now",
        content: {
          title: `Coding in ${p.activity.projectAlias}`,
          description: `Active session with ${p.activity.tool} · ${p.activity.model ?? "AI Pair"}`,
          meta: "Live pairing",
        },
        reactions: { respect: 3, flame: 5 },
      });
    }
  }

  // 3. Default high-energy community highlights
  events.push(
    {
      id: "feed-highlight-project",
      type: "project",
      user: {
        username: "anal",
        displayName: "EmilSwag",
        avatarUrl: "https://server-production-cc06.up.railway.app/uploads/avatars/cmtlczp8l0000xt8qsebhqh9m-4aa5feb01cef.jpg",
      },
      timestamp: "1h ago",
      content: {
        title: "Pushed 14 commits to vibehub",
        description: "Added persistent autostart tracker, strict monochrome badges & live social feed.",
        meta: "TypeScript · React",
        projectSlug: "vibehub",
      },
      reactions: { respect: 12, flame: 19 },
    },
    {
      id: "feed-highlight-opus",
      type: "achievement",
      user: {
        username: "boris",
        displayName: "Phil Mac",
        avatarUrl: "https://avatars.githubusercontent.com/u/226489168?v=4",
      },
      timestamp: "3h ago",
      badgeId: "opus-tamer",
      content: {
        title: "UNLOCKED: OPUS TAMER",
        description: "Logged 10+ hours pairing alongside Claude Opus 5.",
        meta: "Level 49 milestone",
      },
      reactions: { respect: 6, flame: 9 },
    },
    {
      id: "feed-highlight-level",
      type: "level",
      user: {
        username: "anal",
        displayName: "EmilSwag",
        avatarUrl: "https://server-production-cc06.up.railway.app/uploads/avatars/cmtlczp8l0000xt8qsebhqh9m-4aa5feb01cef.jpg",
      },
      timestamp: "5h ago",
      badgeId: "streak-master",
      content: {
        title: "Ascended to LEVEL 165",
        description: "270k XP accumulated across 65 hours of verified AI pairing.",
        meta: "7d streak maintained",
      },
      reactions: { respect: 24, flame: 42, userReactedRespect: true },
    }
  );

  return events;
}
